import { describe, it, expect } from "vitest";
import { startPreviewServer } from "./preview.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../core/test/fixtures");

describe("preview server", () => {
  it("serves rendered HTML at /_preview", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/_preview`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Hello, Tender");
    } finally {
      await server.close();
    }
  }, 60_000);

  it("serves the preview-ui shell HTML at /", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<div id=\"root\">");
      expect(html).toMatch(/_ui\/assets\//);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("serves the SPA shell for client-side routes (refresh / direct URL)", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      for (const path of ["/help", "/palette", "/some/deep/route"]) {
        const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
        expect(res.status, `expected 200 for ${path}`).toBe(200);
        const html = await res.text();
        expect(html).toContain('<div id="root">');
      }
    } finally {
      await server.close();
    }
  }, 30_000);

  it("serves preview-ui bundle assets under /_ui/", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      const shellHtml = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
      const scriptMatch = shellHtml.match(/src="(\/_ui\/assets\/[^"]+\.js)"/);
      expect(scriptMatch).not.toBeNull();
      const scriptRes = await fetch(`http://127.0.0.1:${server.port}${scriptMatch![1]}`);
      expect(scriptRes.status).toBe(200);
      expect(scriptRes.headers.get("content-type")).toMatch(/javascript/);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("serves assets/ directory", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "with-image"),
      port: 0
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/assets/images/dot.png`);
      expect(res.status).toBe(200);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("sends typed WS messages identifying the changed file kind", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-ws-"));
    try {
      // Seed minimal project
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hi`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
        const message = await new Promise<string>((resolve, reject) => {
          ws.on("open", async () => {
            await writeFile(join(tmp, "content.md"), `# Hello again`);
          });
          ws.on("message", (data) => resolve(data.toString()));
          ws.on("error", reject);
          setTimeout(() => reject(new Error("timeout")), 10_000);
        });
        ws.close();
        const parsed = JSON.parse(message);
        expect(parsed.kind).toBe("content");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it("emits a components-kind WS message when a .tender file changes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-ws-comp-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hi`);
      await mkdir(join(tmp, "components"), { recursive: true });
      await writeFile(
        join(tmp, "components", "widget.tender"),
        "---\ntag: div\n---\n\n<style>\n.widget { color: red; }\n</style>\n"
      );

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
        const message = await new Promise<string>((resolve, reject) => {
          ws.on("open", async () => {
            // Give chokidar time to install inotify watches on subdirectories.
            // Without this delay the rewrite below fires before components/
            // is being watched, and the test times out.
            await new Promise(r => setTimeout(r, 500));
            await writeFile(
              join(tmp, "components", "widget.tender"),
              "---\ntag: div\n---\n\n<style>\n.widget { color: blue; }\n</style>\n"
            );
          });
          ws.on("message", (data) => resolve(data.toString()));
          ws.on("error", reject);
          setTimeout(() => reject(new Error("timeout")), 15_000);
        });
        ws.close();
        const parsed = JSON.parse(message);
        expect(parsed.kind).toBe("components");

        // After rebuild, /_api/_components.css reflects the new contents.
        const cssRes = await fetch(`http://127.0.0.1:${server.port}/_api/_components.css`);
        expect(cssRes.status).toBe(200);
        expect(await cssRes.text()).toContain(".widget { color: blue; }");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it("serves /_api/palette as JSON for projects with components", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "components"),
      port: 0
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/_api/palette`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = await res.json();
      expect(body.components.length).toBeGreaterThan(0);
      expect(body.typography.length).toBeGreaterThan(0);
      // The fixture declares two components: `callout` (wrapper) and `row`
      // (block template). After the merge both live in the same array;
      // alphabetical insertion order from project.yaml puts `callout` first.
      const calloutEntry = body.components.find((c: { name: string }) => c.name === "callout");
      expect(calloutEntry).toBeDefined();
      expect(calloutEntry.renders[0].html).toContain("<aside");
      const rowEntry = body.components.find((c: { name: string }) => c.name === "row");
      expect(rowEntry).toBeDefined();
    } finally {
      await server.close();
    }
  }, 30_000);

  it("serves /_api/help with HTML and source field", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/_api/help`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe("builtin");
      expect(body.html).toMatch(/<h1[^>]*>/);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("serves /_api/styles.css and /_api/_project.css", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      const stylesRes = await fetch(`http://127.0.0.1:${server.port}/_api/styles.css`);
      expect(stylesRes.status).toBe(200);
      expect(stylesRes.headers.get("content-type")).toMatch(/text\/css/);
      expect(await stylesRes.text()).toContain("font-family");

      const projectRes = await fetch(`http://127.0.0.1:${server.port}/_api/_project.css`);
      expect(projectRes.status).toBe(200);
      expect(await projectRes.text()).toContain("@page");
    } finally {
      await server.close();
    }
  }, 30_000);

  it("/_api/docs returns the discovered set with the right default", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-docs-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      await writeFile(join(tmp, "resume.md"), `# Resume`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const res = await fetch(`http://127.0.0.1:${server.port}/_api/docs`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.docs.map((d: { basename: string }) => d.basename)).toEqual(["content", "resume"]);
        expect(body.default).toBe("content");
        const content = body.docs.find((d: { basename: string }) => d.basename === "content");
        expect(content.isContent).toBe(true);
        expect(content.filename).toBe("content.md");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("POST /_api/build builds every doc to out/<doc>.pdf and serves them for download", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-build-pdf-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      await writeFile(join(tmp, "resume.md"), `# Resume`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const res = await fetch(`http://127.0.0.1:${server.port}/_api/build`, { method: "POST" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.results.map((r: { doc: string }) => r.doc).sort()).toEqual(["content", "resume"]);
        for (const r of body.results) {
          expect(r.ok).toBe(true);
          expect(r.bytes).toBeGreaterThan(1000);
          expect(r.downloadUrl).toBe(`/_api/out/${r.doc}.pdf`);
        }
        // Files actually on disk under out/.
        const pdf = await readFile(join(tmp, "out", "content.pdf"));
        expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
        // Downloadable through the server.
        const dl = await fetch(`http://127.0.0.1:${server.port}/_api/out/resume.pdf`);
        expect(dl.status).toBe(200);
        expect(dl.headers.get("content-type")).toMatch(/application\/pdf/);
        const dlBuf = Buffer.from(await dl.arrayBuffer());
        expect(dlBuf.subarray(0, 4).toString()).toBe("%PDF");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it("POST /_api/build?doc=<name> builds just that doc; ?doc=missing 404s", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-build-one-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      await writeFile(join(tmp, "resume.md"), `# Resume`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const one = await fetch(`http://127.0.0.1:${server.port}/_api/build?doc=resume`, { method: "POST" });
        expect(one.status).toBe(200);
        const oneBody = await one.json();
        expect(oneBody.results).toHaveLength(1);
        expect(oneBody.results[0]).toMatchObject({ doc: "resume", ok: true });
        // content.pdf was NOT built (only resume was asked for).
        await expect(readFile(join(tmp, "out", "content.pdf"))).rejects.toThrow();

        const missing = await fetch(`http://127.0.0.1:${server.port}/_api/build?doc=nope`, { method: "POST" });
        expect(missing.status).toBe(404);
        const missingBody = await missing.json();
        expect(missingBody.error).toMatch(/nope/);
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it("POST /_api/build reports a per-doc error without failing the whole build", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-build-err-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      await writeFile(join(tmp, "broken.md"), `:::definitely-not-real\noops\n:::\n`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const res = await fetch(`http://127.0.0.1:${server.port}/_api/build`, { method: "POST" });
        expect(res.status).toBe(200);
        const body = await res.json();
        const byDoc = Object.fromEntries(body.results.map((r: { doc: string }) => [r.doc, r]));
        expect(byDoc.content.ok).toBe(true);
        expect(byDoc.broken.ok).toBe(false);
        expect(byDoc.broken.error).toMatch(/Unknown component/i);
        // The good doc's PDF still landed.
        const pdf = await readFile(join(tmp, "out", "content.pdf"));
        expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it("GET /_api/out/<bad> rejects non-pdf and traversal", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-out-guard-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        expect((await fetch(`http://127.0.0.1:${server.port}/_api/out/notes.txt`)).status).toBe(400);
        expect((await fetch(`http://127.0.0.1:${server.port}/_api/out/${encodeURIComponent("../project.yaml")}`)).status).toBe(400);
        // A .pdf that was never built — well-formed name, but 404.
        expect((await fetch(`http://127.0.0.1:${server.port}/_api/out/nope.pdf`)).status).toBe(404);
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("/_api/docs.default reflects --doc", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-docs-default-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      await writeFile(join(tmp, "resume.md"), `# Resume`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0, docName: "resume" });
      try {
        const res = await fetch(`http://127.0.0.1:${server.port}/_api/docs`);
        const body = await res.json();
        expect(body.default).toBe("resume");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("/_preview?doc=<name> serves the named doc; without ?doc= falls back to the default", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-preview-doc-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Cover Page Marker`);
      await writeFile(join(tmp, "resume.md"), `# Resume Heading`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const resumeRes = await fetch(`http://127.0.0.1:${server.port}/_preview?doc=resume`);
        expect(resumeRes.status).toBe(200);
        expect(await resumeRes.text()).toMatch(/Resume/i);

        const defaultRes = await fetch(`http://127.0.0.1:${server.port}/_preview`);
        expect(defaultRes.status).toBe(200);
        expect(await defaultRes.text()).toMatch(/Cover Page Marker/);
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("WS content message on a non-content doc change carries the doc name", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-ws-docname-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hi`);
      await writeFile(join(tmp, "resume.md"), `# Resume`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
        const message = await new Promise<string>((resolve, reject) => {
          ws.on("open", async () => {
            // Give chokidar a moment so the rewrite reliably registers.
            await new Promise(r => setTimeout(r, 250));
            await writeFile(join(tmp, "resume.md"), `# Resume Updated`);
          });
          ws.on("message", (data) => resolve(data.toString()));
          ws.on("error", reject);
          setTimeout(() => reject(new Error("timeout")), 15_000);
        });
        ws.close();
        const parsed = JSON.parse(message);
        expect(parsed.kind).toBe("content");
        expect(parsed.doc).toBe("resume");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it("emits a docs-kind WS message when a new root .md is added and the doc list updates", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-ws-docs-add-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hi`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
        const sawDocs = new Promise<void>((resolve, reject) => {
          ws.on("open", async () => {
            await new Promise(r => setTimeout(r, 250));
            await writeFile(join(tmp, "cover-letter.md"), `# Cover Letter`);
          });
          ws.on("message", (data) => {
            const parsed = JSON.parse(data.toString());
            if (parsed.kind === "docs") resolve();
          });
          ws.on("error", reject);
          setTimeout(() => reject(new Error("timeout waiting for docs event")), 15_000);
        });
        await sawDocs;
        ws.close();

        const res = await fetch(`http://127.0.0.1:${server.port}/_api/docs`);
        const body = await res.json();
        const names = body.docs.map((d: { basename: string }) => d.basename);
        expect(names).toContain("cover-letter");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it("--doc <name> wins as default even when the doc fails to build", async () => {
    // Provoke a deterministic build error: a closing HTML-style tag with no
    // matching opener trips preprocess-tags' "no matching opener" throw,
    // which surfaces through buildProject as a thrown Error.
    const tmp = await mkdtemp(join(tmpdir(), "tender-doc-err-default-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      // `:::unknown-thing` is parsed as a directive; resolveComponents
      // throws "Unknown component" when the name isn't in the registry,
      // which surfaces through buildProject as a build error.
      await writeFile(join(tmp, "resume.md"), `:::unknown-thing\nbody\n:::\n`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0, docName: "resume" });
      try {
        const docsRes = await fetch(`http://127.0.0.1:${server.port}/_api/docs`);
        const docsBody = await docsRes.json();
        // Even though resume.md threw during the initial build, --doc must
        // still pin the default to resume (otherwise the user silently sees
        // content with no indication their requested doc is broken).
        expect(docsBody.default).toBe("resume");

        // /_preview (no ?doc=) honours the default and shows the error page.
        const previewRes = await fetch(`http://127.0.0.1:${server.port}/_preview`);
        expect(previewRes.status).toBe(200);
        const previewHtml = await previewRes.text();
        expect(previewHtml).toContain("Build error:");
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("a previously-erroring doc becomes serveable once corrected", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-doc-recover-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hello`);
      // `:::unknown-thing` is parsed as a directive; resolveComponents
      // throws "Unknown component" when the name isn't in the registry,
      // which surfaces through buildProject as a build error.
      await writeFile(join(tmp, "resume.md"), `:::unknown-thing\nbody\n:::\n`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        // Confirm it starts in the error state.
        const errRes = await fetch(`http://127.0.0.1:${server.port}/_preview?doc=resume`);
        expect(await errRes.text()).toContain("Build error:");

        // Fix it via a WS-observed rewrite so we know the rebuild settled.
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
        await new Promise<void>((resolve, reject) => {
          ws.on("open", async () => {
            await new Promise(r => setTimeout(r, 250));
            await writeFile(join(tmp, "resume.md"), `# Fixed Resume`);
          });
          ws.on("message", (data) => {
            const parsed = JSON.parse(data.toString());
            if (parsed.kind === "content" && parsed.doc === "resume") resolve();
          });
          ws.on("error", reject);
          setTimeout(() => reject(new Error("timeout waiting for recovery")), 15_000);
        });
        ws.close();

        const okRes = await fetch(`http://127.0.0.1:${server.port}/_preview?doc=resume`);
        const okHtml = await okRes.text();
        expect(okHtml).not.toContain("Build error:");
        expect(okHtml).toMatch(/Fixed Resume/);
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it("/_preview?doc=<deleted> falls back to the no-document HTML and /_api/docs drops it", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-doc-unlink-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hi`);
      await writeFile(join(tmp, "resume.md"), `# Resume`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        // Drive an unlink via a WS observer so we know discoverDocs ran.
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
        await new Promise<void>((resolve, reject) => {
          ws.on("open", async () => {
            await new Promise(r => setTimeout(r, 250));
            await rm(join(tmp, "resume.md"));
          });
          ws.on("message", (data) => {
            const parsed = JSON.parse(data.toString());
            if (parsed.kind === "docs") resolve();
          });
          ws.on("error", reject);
          setTimeout(() => reject(new Error("timeout waiting for docs event")), 15_000);
        });
        ws.close();

        const docsRes = await fetch(`http://127.0.0.1:${server.port}/_api/docs`);
        const docsBody = await docsRes.json();
        const names = docsBody.docs.map((d: { basename: string }) => d.basename);
        expect(names).not.toContain("resume");

        const previewRes = await fetch(`http://127.0.0.1:${server.port}/_preview?doc=resume`);
        expect(previewRes.status).toBe(200);
        const previewHtml = await previewRes.text();
        // Falls through to the "No document" sentinel (the cached error/ok
        // entry was cleared by the unlink handler).
        expect(previewHtml).toContain(`No document "resume"`);
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it("README.md changes do NOT trigger a WS broadcast", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "tender-readme-skip-"));
    try {
      await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
      await writeFile(join(tmp, "styles.css"), `body{}`);
      await writeFile(join(tmp, "content.md"), `# Hi`);
      await writeFile(join(tmp, "README.md"), `# README initial`);

      const server = await startPreviewServer({ projectDir: tmp, port: 0 });
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
        let messageReceived = false;
        await new Promise<void>((resolve, reject) => {
          ws.on("open", async () => {
            await new Promise(r => setTimeout(r, 250));
            await writeFile(join(tmp, "README.md"), `# README updated`);
          });
          ws.on("message", () => {
            messageReceived = true;
          });
          ws.on("error", reject);
          // Wait long enough that the awaitWriteFinish stability window
          // (100ms) and chokidar's event loop both have time to fire.
          setTimeout(resolve, 1500);
        });
        ws.close();
        expect(messageReceived).toBe(false);
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it("binds to a custom host when --host is supplied", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0,
      host: "0.0.0.0"
    });
    try {
      expect(server.host).toBe("0.0.0.0");
      // 0.0.0.0 means all interfaces; loopback fetch should still succeed.
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(200);
    } finally {
      await server.close();
    }
  }, 60_000);
});
