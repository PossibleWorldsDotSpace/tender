import { describe, it, expect } from "vitest";
import { startPreviewServer } from "./preview.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
