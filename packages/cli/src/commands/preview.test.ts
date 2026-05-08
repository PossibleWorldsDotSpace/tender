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

  it("serves a placeholder shell at / that embeds /_preview", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      // Phase 0 placeholder: a tiny HTML page with an iframe to /_preview
      expect(html).toContain("/_preview");
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
      expect(body.templates.length).toBeGreaterThan(0);
      expect(body.typography.length).toBeGreaterThan(0);
      expect(body.components[0].name).toBe("callout");
      expect(body.components[0].renders[0].html).toContain("<aside");
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
