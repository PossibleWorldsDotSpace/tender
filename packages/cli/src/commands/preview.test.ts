import { describe, it, expect } from "vitest";
import { startPreviewServer } from "./preview.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
});
