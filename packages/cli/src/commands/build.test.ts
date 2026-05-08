import { describe, it, expect } from "vitest";
import { build } from "./build.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
// Reuse the core fixtures
const fixture = join(here, "../../../core/test/fixtures/hello");
const COASTAL = join(here, "../../../core/test/fixtures/coastal-planet");

describe("build command", () => {
  it("writes document.pdf and document.html to the out dir", async () => {
    const out = await mkdtemp(join(tmpdir(), "tender-build-"));
    try {
      await build({ projectDir: fixture, outDir: out });
      const pdfStat = await stat(join(out, "document.pdf"));
      expect(pdfStat.size).toBeGreaterThan(1000);
      const html = await readFile(join(out, "document.html"), "utf8");
      expect(html).toContain("Hello, Tender");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("coastal-planet: produces a multi-page PDF", async () => {
    const out = await mkdtemp(join(tmpdir(), "tender-coastal-"));
    try {
      await build({ projectDir: COASTAL, outDir: out });
      const pdf = await readFile(join(out, "document.pdf"));
      expect(pdf.length).toBeGreaterThan(20_000);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);
});
