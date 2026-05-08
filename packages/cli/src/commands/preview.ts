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
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

const RELOAD_SCRIPT = `<script>
(() => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/_tender');
  ws.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
})();
</script>`;

async function renderForPreview(projectDir: string): Promise<string> {
  const result = await buildProject(projectDir);
  const html = await renderHtml(result);
  // Inject reload script before </body>.
  if (html.includes("</body>")) {
    return html.replace("</body>", RELOAD_SCRIPT + "</body>");
  }
  return html + RELOAD_SCRIPT;
}

export async function startPreviewServer(opts: PreviewOptions): Promise<RunningServer> {
  const app = express();
  let cachedHtml: string | null = null;
  let buildError: Error | null = null;

  async function rebuild(): Promise<void> {
    try {
      cachedHtml = await renderForPreview(opts.projectDir);
      buildError = null;
    } catch (err) {
      buildError = err instanceof Error ? err : new Error(String(err));
      cachedHtml = `<!DOCTYPE html><html><body><pre>Build error: ${escapeHtml(buildError.message)}</pre>${RELOAD_SCRIPT}</body></html>`;
    }
  }

  await rebuild();

  app.use("/assets", express.static(join(opts.projectDir, "assets")));

  app.get("/", async (_req, res) => {
    res.type("html").send(cachedHtml ?? "");
  });

  const server: Server = await new Promise(resolve => {
    const s = app.listen(opts.port, "127.0.0.1", () => resolve(s));
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
    await rebuild();
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send("reload");
    }
  });

  return {
    port,
    close: async () => {
      await new Promise<void>(resolve => {
        wss.close(() => resolve());
      });
      await watcher.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
}
