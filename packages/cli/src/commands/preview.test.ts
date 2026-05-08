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
  it("serves rendered HTML at /", async () => {
    const server = await startPreviewServer({
      projectDir: join(fixturesDir, "hello"),
      port: 0
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Hello, Tender");
    } finally {
      await server.close();
    }
  }, 60_000);

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
