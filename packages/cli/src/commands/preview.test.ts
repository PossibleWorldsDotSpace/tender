import { describe, it, expect } from "vitest";
import { startPreviewServer } from "./preview.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
