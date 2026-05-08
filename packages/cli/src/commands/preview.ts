import express from "express";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Server } from "node:http";
import { dirname, join, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { buildProject, buildPalette, renderHelp } from "@tender/core";
import type { BuildResult } from "@tender/core";
import { createRenderSession } from "@tender/render";
import type { RenderSession } from "@tender/render";

const previewUiDist = (() => {
  const pkg = createRequire(import.meta.url).resolve("@tender/preview-ui/package.json");
  return join(dirname(pkg), "dist");
})();

export interface PreviewOptions {
  projectDir: string;
  port: number;
  host?: string;
}

export interface RunningServer {
  port: number;
  host: string;
  close: () => Promise<void>;
}

type WsMessage =
  | { kind: "content" }
  | { kind: "project" }
  | { kind: "styles" }
  | { kind: "help" }
  | { kind: "assets" }
  | { kind: "error"; message: string };

function classifyPath(path: string, projectDir: string): Exclude<WsMessage, { kind: "error" }>["kind"] {
  const rel = path.startsWith(projectDir) ? path.slice(projectDir.length + 1) : path;
  if (rel === "content.md") return "content";
  if (rel === "project.yaml") return "project";
  if (rel === "styles.css") return "styles";
  if (rel === "docs/user-guide.md" || rel === "docs" + sep + "user-guide.md") return "help";
  if (rel.startsWith("assets/") || rel.startsWith("assets" + sep)) return "assets";
  return "content"; // default fallback
}

const RELOAD_SCRIPT = `<script>
(() => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/_tender');
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.kind !== 'error') location.reload();
    } catch { location.reload(); }
  };
})();
</script>`;

// Visual chrome that makes the rendered Paged.js DOM look like printed sheets:
// grey workspace, white pages with a soft drop-shadow, page numbers, optional
// margin guides. Injected only in the preview server — not in PDF/HTML output.
const PREVIEW_CHROME = `<style>
  html { background: #d8d8d8; }
  body { background: #d8d8d8; padding: 16px 0; }
  .pagedjs_pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .pagedjs_page {
    background: white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    counter-increment: page;
    position: relative;
  }
  .pagedjs_page::after {
    content: counter(page);
    position: absolute;
    bottom: -22px;
    left: 50%;
    transform: translateX(-50%);
    font: 11px/1 system-ui, sans-serif;
    color: #666;
  }
  /*
    Margin guide: faint dashed rectangle showing the printable area on each
    sheet. Drawn as a ::before pseudo-element on .pagedjs_page itself (not
    .pagedjs_area, whose bounding box can spill past the sheet because Paged.js
    sizes it from letter-dimensioned CSS custom properties). Inset by the
    actual page-margin variables so the guide always lands on the visible
    sheet and is symmetric on all four sides.
  */
  .pagedjs_page::before {
    content: "";
    position: absolute;
    top: var(--pagedjs-margin-top);
    bottom: var(--pagedjs-margin-bottom);
    left: var(--pagedjs-margin-left);
    right: var(--pagedjs-margin-right);
    border: 1px dashed rgba(0,0,0,0.12);
    pointer-events: none;
    z-index: 1;
  }
</style>`;

function injectPreviewExtras(html: string): string {
  const inject = PREVIEW_CHROME + RELOAD_SCRIPT;
  if (html.includes("</body>")) return html.replace("</body>", inject + "</body>");
  return html + inject;
}

export async function startPreviewServer(opts: PreviewOptions): Promise<RunningServer> {
  const app = express();
  let cachedHtml: string | null = null;
  let cachedBuildResult: BuildResult | null = null;
  let buildError: Error | null = null;

  // One Chromium for the lifetime of the server. Each rebuild creates a fresh
  // page on this browser instead of paying ~1-3s of cold-start every save.
  const renderSession: RenderSession = await createRenderSession();

  async function rebuild(): Promise<void> {
    try {
      cachedBuildResult = await buildProject(opts.projectDir);
      const html = await renderSession.renderHtml(cachedBuildResult);
      cachedHtml = injectPreviewExtras(html);
      if (buildError) console.log("preview: build recovered");
      buildError = null;
    } catch (err) {
      buildError = err instanceof Error ? err : new Error(String(err));
      console.error(`preview: build error: ${buildError.message}`);
      cachedHtml = `<!DOCTYPE html><html><body><pre>Build error: ${escapeHtml(buildError.message)}</pre>${RELOAD_SCRIPT}</body></html>`;
      // Keep cachedBuildResult on error so endpoints can still serve last-good state.
    }
  }

  await rebuild();

  async function ensureBuildResult(): Promise<BuildResult> {
    if (!cachedBuildResult) cachedBuildResult = await buildProject(opts.projectDir);
    return cachedBuildResult;
  }

  app.use("/assets", express.static(join(opts.projectDir, "assets")));

  app.get("/_api/palette", async (_req, res, next) => {
    try {
      const result = await ensureBuildResult();
      const palette = await buildPalette(result.config);
      res.json(palette);
    } catch (err) {
      next(err);
    }
  });

  app.get("/_api/help", async (_req, res, next) => {
    try {
      res.json(await renderHelp(opts.projectDir));
    } catch (err) {
      next(err);
    }
  });

  app.get("/_api/styles.css", async (_req, res, next) => {
    try {
      const result = await ensureBuildResult();
      res.type("text/css").send(result.stylesCss);
    } catch (err) {
      next(err);
    }
  });

  app.get("/_api/_project.css", async (_req, res, next) => {
    try {
      const result = await ensureBuildResult();
      res.type("text/css").send(result.projectCss);
    } catch (err) {
      next(err);
    }
  });

  app.get("/_preview", async (_req, res) => {
    res.type("html").send(cachedHtml ?? "");
  });

  // Serve preview-ui bundle assets
  app.use("/_ui/assets", express.static(join(previewUiDist, "assets")));

  // SPA shell at / and any non-reserved GET path. Solid Router handles
  // /palette, /help (and any future client routes) — the server returns the
  // same shell HTML for all of them so a hard refresh or direct URL works.
  // Reserved prefixes (handled by the routes above) are skipped here.
  app.get(/.*/, async (req, res, next) => {
    if (req.method !== "GET") return next();
    const p = req.path;
    if (
      p.startsWith("/_api/") ||
      p.startsWith("/_ui/") ||
      p === "/_preview" ||
      p === "/_tender" ||
      p.startsWith("/assets/")
    ) {
      return next();
    }
    try {
      const shell = await readFile(join(previewUiDist, "index.html"), "utf8");
      res.type("html").send(shell);
    } catch (err) {
      next(err);
    }
  });

  const host = opts.host ?? "127.0.0.1";
  const server: Server = await new Promise(resolve => {
    const s = app.listen(opts.port, host, () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind preview server");
  }
  const port = address.port;

  // Websocket for reload
  const wss = new WebSocketServer({ server, path: "/_tender" });

  // File watcher
  const watcher: FSWatcher = chokidar.watch(opts.projectDir, {
    ignored: /node_modules|\.git|out|dist/,
    ignoreInitial: true
  });

  watcher.on("all", async (_event, path) => {
    try {
      const kind = classifyPath(path, opts.projectDir);
      // Help-only changes don't affect the rendered preview — skip rebuild.
      if (kind !== "help") {
        await rebuild();
      }
      const msg: WsMessage = buildError
        ? { kind: "error", message: buildError.message }
        : { kind };
      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (client.readyState === 1 /* OPEN */) client.send(payload);
      }
    } catch (err) {
      console.error("preview rebuild failed:", err instanceof Error ? err.message : err);
    }
  });

  return {
    port,
    host,
    close: async () => {
      // Terminate WS clients first; otherwise wss.close() and server.close()
      // hang waiting for them to disconnect.
      for (const client of wss.clients) client.terminate();
      await new Promise<void>(resolve => {
        wss.close(() => resolve());
      });
      await watcher.close();
      // Drop any remaining HTTP keep-alive sockets; available since Node 18.2.
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      // Tear down Chromium; otherwise it keeps running after the server stops.
      await renderSession.close();
    }
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
}
