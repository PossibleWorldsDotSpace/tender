import express from "express";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Server } from "node:http";
import { dirname, join, sep, basename } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { buildProject, buildPalette, renderHelp, listDocuments } from "@tender/core";
import type { BuildResult, ProjectDocument } from "@tender/core";
import { createRenderSession } from "@tender/render";
import type { RenderSession } from "@tender/render";
import { init, KNOWN_EXAMPLES, type ExampleName } from "./init.js";

const previewUiDist = (() => {
  const pkg = createRequire(import.meta.url).resolve("@tender/preview-ui/package.json");
  return join(dirname(pkg), "dist");
})();

export interface PreviewOptions {
  projectDir: string;
  port: number;
  host?: string;
  /** Doc the UI should load first (basename without .md). */
  docName?: string;
}

export interface RunningServer {
  port: number;
  host: string;
  close: () => Promise<void>;
}

type WsMessage =
  | { kind: "content"; doc: string }
  | { kind: "project" }
  | { kind: "components" }
  | { kind: "styles" }
  | { kind: "assets" }
  | { kind: "docs" }
  | { kind: "error"; message: string };

type ClassifiedKind =
  | "content"
  | "project"
  | "styles"
  | "assets"
  | "components"
  | "skip";

interface Classified {
  kind: ClassifiedKind;
  /** Set when kind === "content": the basename (without .md) of the doc. */
  doc?: string;
}

function classifyPath(path: string, projectDir: string): Classified {
  const rel = path.startsWith(projectDir) ? path.slice(projectDir.length + 1) : path;
  if (rel === "project.yaml") return { kind: "project" };
  if (rel === "styles.css") return { kind: "styles" };
  if (rel.startsWith("assets/") || rel.startsWith("assets" + sep)) return { kind: "assets" };
  if (rel.startsWith("components/") || rel.startsWith("components" + sep)) return { kind: "components" };
  // Root-level *.md (no path separator) is a document — provided it isn't
  // reserved (README.md or `_*.md`). Anything else falls through to "skip".
  if (!rel.includes("/") && !rel.includes(sep) && rel.endsWith(".md")) {
    if (rel === "README.md" || rel.startsWith("_")) return { kind: "skip" };
    return { kind: "content", doc: rel.slice(0, -3) };
  }
  return { kind: "skip" };
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
// dark workspace (matches the preview-ui app background — see styles.css --bg),
// white pages with a soft drop-shadow, page numbers, optional margin guides.
// Injected only in the preview server — not in PDF/HTML output.
const PREVIEW_CHROME = `<style>
  html { background: #030305; }
  body { background: #030305; padding: 16px 0; }
  /* Match the preview-ui chrome scrollbar — see preview-ui/src/styles.css. */
  html { scrollbar-width: thin; scrollbar-color: #30363d #030305; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: #030305; }
  ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 8px; }
  ::-webkit-scrollbar-thumb:hover { background: #8b949e; }
  ::-webkit-scrollbar-corner { background: #030305; }
  .pagedjs_pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .pagedjs_page {
    background: white;
    box-shadow: 0 2px 16px rgba(0,0,0,0.5);
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
    color: #8b949e;
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

const EMPTY_DOCS_HTML = `<!DOCTYPE html><html><body><pre>No documents in this project. Add a *.md file at the project root.</pre>${RELOAD_SCRIPT}</body></html>`;

/**
 * Per-document cache entry. Discriminated by `kind` so that a single map can
 * hold both successfully-built docs and docs that are currently in error
 * (with optional last-good build retained for project-wide endpoints).
 *
 * Storing both states in one map means a recovered doc atomically overwrites
 * its error state via a single `docCaches.set` — no risk of the same doc
 * lingering in a parallel error map.
 */
type DocCache =
  | { kind: "ok"; html: string; build: BuildResult }
  | { kind: "error"; html: string; build: BuildResult | null };

export async function startPreviewServer(opts: PreviewOptions): Promise<RunningServer> {
  const app = express();

  // Per-document cache: one entry per root *.md document, ok or error.
  // Project-wide endpoints (palette, styles.css) read from whichever doc is
  // the current "default" (see defaultBuild()).
  const docCaches = new Map<string, DocCache>();
  let docs: ProjectDocument[] = [];
  let buildError: Error | null = null;

  // One Chromium for the lifetime of the server. Each rebuild creates a fresh
  // page on this browser instead of paying ~1-3s of cold-start every save.
  const renderSession: RenderSession = await createRenderSession();

  async function discoverDocs(): Promise<void> {
    docs = await listDocuments(opts.projectDir);
  }

  function defaultDocName(): string | null {
    // Honour --doc even when the requested doc failed to build: as long as
    // it has *any* entry (ok or error), it stays the default. Otherwise the
    // user would silently see content.md instead of the broken doc they
    // asked for, with no indication their doc is failing.
    if (opts.docName && docCaches.has(opts.docName)) return opts.docName;
    return docs[0]?.basename ?? null;
  }

  function defaultBuild(): BuildResult | null {
    // Project-wide endpoints need a BuildResult; an error-only entry may
    // still carry a last-good build, so prefer that. Otherwise scan for any
    // cached entry that has a build.
    const name = defaultDocName();
    if (name) {
      const entry = docCaches.get(name);
      if (entry?.build) return entry.build;
    }
    for (const entry of docCaches.values()) {
      if (entry.build) return entry.build;
    }
    return null;
  }

  async function rebuildOne(docName: string): Promise<void> {
    const previous = docCaches.get(docName);
    try {
      const build = await buildProject(opts.projectDir, { docName });
      const html = await renderSession.renderHtml(build);
      // Single set: any prior error entry for this doc is replaced atomically.
      docCaches.set(docName, { kind: "ok", html: injectPreviewExtras(html), build });
      if (buildError) console.log("preview: build recovered");
      buildError = null;
    } catch (err) {
      buildError = err instanceof Error ? err : new Error(String(err));
      console.error(`preview: build error (${docName}): ${buildError.message}`);
      const errorHtml = `<!DOCTYPE html><html><body><pre>Build error: ${escapeHtml(buildError.message)}</pre>${RELOAD_SCRIPT}</body></html>`;
      // Preserve the last-good BuildResult (if any) so project-wide endpoints
      // can still serve config/CSS while the doc itself shows the error.
      docCaches.set(docName, { kind: "error", html: errorHtml, build: previous?.build ?? null });
    }
  }

  async function rebuildAll(): Promise<void> {
    await discoverDocs();
    // Drop caches for docs that no longer exist.
    const live = new Set(docs.map(d => d.basename));
    for (const name of [...docCaches.keys()]) if (!live.has(name)) docCaches.delete(name);
    for (const d of docs) await rebuildOne(d.basename);
  }

  await rebuildAll();

  async function ensureBuildResult(): Promise<BuildResult> {
    const existing = defaultBuild();
    if (existing) return existing;
    const name = defaultDocName();
    if (name) {
      await rebuildOne(name);
      const after = defaultBuild();
      if (after) return after;
    }
    // No docs at all — fall back to a fresh content.md build so the
    // project-wide endpoints can still surface a useful error.
    return buildProject(opts.projectDir);
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
      res.json(await renderHelp());
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

  app.get("/_api/_components.css", async (_req, res, next) => {
    try {
      const result = await ensureBuildResult();
      res.type("text/css").send(result.componentsCss);
    } catch (err) {
      next(err);
    }
  });

  app.get("/_api/docs", (_req, res) => {
    res.json({
      docs: docs.map(d => ({
        basename: d.basename,
        filename: d.filename,
        isContent: d.isContent
      })),
      default: defaultDocName()
    });
  });

  // --- PDF export -----------------------------------------------------------
  //
  // The Export tab calls POST /_api/build (all docs) or POST /_api/build?doc=x
  // (one). PDFs are written to <projectDir>/out/<doc>.pdf — the same place
  // `tender build` puts them, and a path the file watcher already ignores, so
  // writing there doesn't trigger a rebuild loop. The response carries a
  // per-doc result; freshly-built PDFs are downloadable via GET /_api/out/...

  const outDir = join(opts.projectDir, "out");
  // Serialize builds: a build-all loops over docs reusing the one Chromium,
  // and two overlapping build-alls would interleave page renders pointlessly.
  let buildInFlight: Promise<void> | null = null;

  interface DocPdfResult {
    doc: string;
    ok: boolean;
    /** Absolute path of the written PDF (on success). */
    path?: string;
    /** Download URL relative to the server root (on success). */
    downloadUrl?: string;
    /** Byte size of the written PDF (on success). */
    bytes?: number;
    /** Error message (on failure). */
    error?: string;
  }

  /**
   * Build one document to PDF and write it to out/. Uses the cached BuildResult
   * when the doc is currently in a good state; otherwise rebuilds it fresh
   * (which also refreshes the cache and preview HTML). Never throws — a build
   * error is reported in the returned result.
   */
  async function buildDocPdf(docName: string): Promise<DocPdfResult> {
    try {
      let entry = docCaches.get(docName);
      if (!entry || entry.kind !== "ok") {
        await rebuildOne(docName);
        entry = docCaches.get(docName);
      }
      if (!entry || entry.kind !== "ok") {
        return { doc: docName, ok: false, error: buildError?.message ?? `Build failed for "${docName}"` };
      }
      const pdf = await renderSession.renderPdf(entry.build);
      await mkdir(outDir, { recursive: true });
      const filename = `${docName}.pdf`;
      const path = join(outDir, filename);
      await writeFile(path, pdf);
      return {
        doc: docName,
        ok: true,
        path,
        downloadUrl: `/_api/out/${encodeURIComponent(filename)}`,
        bytes: pdf.length
      };
    } catch (err) {
      return { doc: docName, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  app.post("/_api/build", express.json(), async (req, res, next) => {
    try {
      const requested = typeof req.query.doc === "string" ? req.query.doc : null;
      // Wait for any in-flight build to finish before starting another.
      while (buildInFlight) await buildInFlight.catch(() => { /* ignore; we re-run */ });
      let resolveDone!: () => void;
      buildInFlight = new Promise<void>(r => { resolveDone = r; });
      try {
        await discoverDocs();
        let targets: string[];
        if (requested !== null) {
          if (!docs.some(d => d.basename === requested)) {
            res.status(404).json({ error: `No document "${requested}"`, results: [] });
            return;
          }
          targets = [requested];
        } else {
          targets = docs.map(d => d.basename);
        }
        const results: DocPdfResult[] = [];
        for (const name of targets) results.push(await buildDocPdf(name));
        res.json({ outDir, results });
      } finally {
        resolveDone();
        buildInFlight = null;
      }
    } catch (err) {
      next(err);
    }
  });

  // Serve a freshly-built PDF for download. Constrained to out/ and to .pdf
  // basenames so this can't be turned into an arbitrary-file read.
  app.get("/_api/out/:file", (req, res) => {
    const file = basename(req.params.file);
    if (!file.endsWith(".pdf") || file.includes(sep) || file.includes("/")) {
      res.status(400).send("bad filename");
      return;
    }
    res.download(join(outDir, file), file, err => {
      if (err && !res.headersSent) res.status(404).send("not built yet");
    });
  });

  // --- Examples ------------------------------------------------------------
  //
  // List the worked examples this CLI ships, and let the UI install one into
  // the running project (refuse-on-conflict unless { force: true }). The
  // examples are the same set the `tender init --example=<name>` CLI exposes.

  app.get("/_api/examples", (_req, res) => {
    res.json({ examples: KNOWN_EXAMPLES });
  });

  app.post("/_api/examples/load", express.json(), async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { name?: string; force?: boolean };
      const name = body.name;
      if (!name || !(KNOWN_EXAMPLES as readonly string[]).includes(name)) {
        res.status(400).json({ error: `Unknown example "${name ?? ""}". Available: ${KNOWN_EXAMPLES.join(", ")}.` });
        return;
      }
      const result = await init(opts.projectDir, { example: name as ExampleName, force: !!body.force });
      // Whether or not init() wrote anything, refresh the doc set and
      // rebuild — the example may have introduced new *.md files and a new
      // component registry. (No-op when init refused due to conflicts.)
      if (result.conflicts.length === 0) {
        await rebuildAll();
        // Tell connected clients to reload so the iframe + tabs pick up the
        // new project shape (docs/components/styles/project all changed).
        broadcast({ kind: "docs" });
        broadcast({ kind: "project" });
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get("/_preview", (req, res) => {
    const requested = typeof req.query.doc === "string" ? req.query.doc : null;
    const name = requested ?? defaultDocName();
    if (!name) {
      res.type("html").send(EMPTY_DOCS_HTML);
      return;
    }
    const cached = docCaches.get(name);
    if (cached) {
      res.type("html").send(cached.html);
      return;
    }
    res.type("html").send(`<!DOCTYPE html><html><body><pre>No document "${escapeHtml(name)}".</pre>${RELOAD_SCRIPT}</body></html>`);
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

  // File watcher. ignoreInitial:true means chokidar won't fire "add" for the
  // files present when the watcher attaches — those were already built above.
  // Only genuinely new files trigger the "add"-branch path below.
  //
  // awaitWriteFinish guards against editors (vim with nowritebackup, shell
  // redirections, some IDE save flows) that truncate the file before flushing
  // the new contents. Without it chokidar fires "add" on the empty file,
  // which parses into a build error, followed by "change" once the real
  // contents land — producing spurious error broadcasts on every save. The
  // 100ms stability window is negligible against a Paged.js render.
  const watcher: FSWatcher = chokidar.watch(opts.projectDir, {
    ignored: /node_modules|\.git|out|dist/,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  });

  function broadcast(msg: WsMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send(payload);
    }
  }

  watcher.on("all", async (event, path) => {
    try {
      const classified = classifyPath(path, opts.projectDir);
      if (classified.kind === "skip") return;

      if (classified.kind === "content") {
        const doc = classified.doc!;
        if (event === "unlink") {
          docCaches.delete(doc);
          await discoverDocs();
          broadcast({ kind: "docs" });
          return;
        }
        if (event === "add") {
          await discoverDocs();
          await rebuildOne(doc);
          if (buildError) {
            broadcast({ kind: "error", message: buildError.message });
          } else {
            broadcast({ kind: "content", doc });
          }
          broadcast({ kind: "docs" });
          return;
        }
        // change (or any other event with the file still present)
        await rebuildOne(doc);
        if (buildError) {
          broadcast({ kind: "error", message: buildError.message });
        } else {
          broadcast({ kind: "content", doc });
        }
        return;
      }

      if (classified.kind === "assets") {
        // Assets are referenced by URL; the HTML doesn't need to be re-rendered
        // for asset-only changes. The UI may still want to reload.
        broadcast({ kind: "assets" });
        return;
      }

      // project / styles / components: registry changed — rebuild every doc.
      await rebuildAll();
      if (buildError) {
        broadcast({ kind: "error", message: buildError.message });
      } else {
        broadcast({ kind: classified.kind });
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
