import express from "express";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Server } from "node:http";
import { join } from "node:path";
import { buildProject } from "@tender/core";
import { renderHtml } from "@tender/render";

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

const RELOAD_SCRIPT = `<script>
(() => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/_tender');
  ws.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
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
  /* Faint dashed outline showing the printable area (inside the margins). */
  .pagedjs_area {
    outline: 1px dashed rgba(0,0,0,0.08);
    outline-offset: -1px;
  }
</style>`;

function injectPreviewExtras(html: string): string {
  const inject = PREVIEW_CHROME + RELOAD_SCRIPT;
  if (html.includes("</body>")) return html.replace("</body>", inject + "</body>");
  return html + inject;
}

async function renderForPreview(projectDir: string): Promise<string> {
  const result = await buildProject(projectDir);
  const html = await renderHtml(result);
  return injectPreviewExtras(html);
}

export async function startPreviewServer(opts: PreviewOptions): Promise<RunningServer> {
  const app = express();
  let cachedHtml: string | null = null;
  let buildError: Error | null = null;

  async function rebuild(): Promise<void> {
    try {
      cachedHtml = await renderForPreview(opts.projectDir);
      if (buildError) console.log("preview: build recovered");
      buildError = null;
    } catch (err) {
      buildError = err instanceof Error ? err : new Error(String(err));
      console.error(`preview: build error: ${buildError.message}`);
      cachedHtml = `<!DOCTYPE html><html><body><pre>Build error: ${escapeHtml(buildError.message)}</pre>${RELOAD_SCRIPT}</body></html>`;
    }
  }

  await rebuild();

  app.use("/assets", express.static(join(opts.projectDir, "assets")));

  app.get("/", async (_req, res) => {
    res.type("html").send(cachedHtml ?? "");
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
    ignored: /node_modules|\.git|out|\\dist/,
    ignoreInitial: true
  });

  watcher.on("all", async () => {
    try {
      await rebuild();
      for (const client of wss.clients) {
        if (client.readyState === 1 /* OPEN */) client.send("reload");
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
    }
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
}
