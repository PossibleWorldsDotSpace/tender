import { describe, it, expect } from "vitest";
import { build } from "./build.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, mkdir, readdir, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
// Reuse the core fixtures
const fixture = join(here, "../../../core/test/fixtures/hello");
const COASTAL = join(here, "../../../core/test/fixtures/coastal-planet");

/** Write a project tree from a flat file map into a fresh tmpdir. */
async function scaffold(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-build-scaffold-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
  return dir;
}

describe("build command", () => {
  it("writes content.pdf and content.html to the out dir", async () => {
    const out = await mkdtemp(join(tmpdir(), "tender-build-"));
    try {
      await build({ projectDir: fixture, outDir: out });
      const pdfStat = await stat(join(out, "content.pdf"));
      expect(pdfStat.size).toBeGreaterThan(1000);
      const html = await readFile(join(out, "content.html"), "utf8");
      expect(html).toContain("Hello, Tender");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("coastal-planet: produces a multi-page PDF", async () => {
    const out = await mkdtemp(join(tmpdir(), "tender-coastal-"));
    try {
      await build({ projectDir: COASTAL, outDir: out });
      const pdf = await readFile(join(out, "content.pdf"));
      expect(pdf.length).toBeGreaterThan(20_000);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("PDF page box matches the @page size (A4), not Chromium's Letter default", async () => {
    const dir = await scaffold({
      "project.yaml":
        "page-templates:\n  default:\n    size: A4\n    margin: { top: 12mm, bottom: 12mm, inner: 12mm, outer: 12mm }\n",
      "styles.css": "",
      "content.md": "# Heading\n\nA paragraph.\n"
    });
    const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
    try {
      await build({ projectDir: dir, outDir, pdfOnly: true });
      const pdf = await readFile(join(outDir, "content.pdf"));
      const m = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
      expect(m).not.toBeNull();
      const w = Number(m![3]);
      const h = Number(m![4]);
      // A4 is 210mm × 297mm = 595.28pt × 841.89pt. Chromium rounds mm→pt at
      // 96 DPI so allow ~1pt of slack; Letter (612 × 792) is way outside it.
      expect(Math.abs(w - 595.28)).toBeLessThan(2);
      expect(Math.abs(h - 841.89)).toBeLessThan(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("renders a GFM table in a document to <table> markup", async () => {
    const dir = await scaffold({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md":
        "# Mechanisms\n\n" +
        "| Mechanism | Purpose |\n" +
        "| ---- | ----: |\n" +
        "| Timeline | Linking past to present |\n"
    });
    const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
    try {
      await build({ projectDir: dir, outDir, htmlOnly: true });
      const html = await readFile(join(outDir, "content.html"), "utf8");
      // Paged.js decorates every element with data-ref, so match loosely.
      expect(html).toMatch(/<table[^>]*>/);
      expect(html).toMatch(/<th[^>]*>Mechanism<\/th>/);
      expect(html).toMatch(/<td[^>]*>Timeline<\/td>/);
      // Literal pipes must not survive into the rendered output.
      expect(html).not.toContain("| Mechanism | Purpose |");
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("passes --doc through to buildProject and writes basename-named output", async () => {
    const dir = await scaffold({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Default",
      "resume.md": "# Resume"
    });
    const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
    try {
      await build({ projectDir: dir, outDir, htmlOnly: true, docName: "resume" });
      const html = await readFile(join(outDir, "resume.html"), "utf8");
      expect(html).toContain("Resume");
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("writes content.{pdf,html} when --doc is omitted in a single-doc project", async () => {
    const dir = await scaffold({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Hi"
    });
    const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
    try {
      await build({ projectDir: dir, outDir, htmlOnly: true });
      // The output should be content.html, NOT document.html.
      const files = await readdir(outDir);
      expect(files).toEqual(["content.html"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("writes one output per doc when --doc is omitted in a multi-doc project", async () => {
    const dir = await scaffold({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Default",
      "resume.md": "# Resume"
    });
    const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
    try {
      await build({ projectDir: dir, outDir, htmlOnly: true });
      const files = await readdir(outDir);
      expect(files.sort()).toEqual(["content.html", "resume.html"]);
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("throws a clear error when --doc names a non-existent document", async () => {
    const dir = await scaffold({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Hi"
    });
    const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
    try {
      await expect(
        build({ projectDir: dir, outDir, docName: "bogus" })
      ).rejects.toThrow(/no document.*bogus/i);
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("throws when the project has no documents at all", async () => {
    const dir = await scaffold({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": ""
    });
    const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
    try {
      await expect(
        build({ projectDir: dir, outDir })
      ).rejects.toThrow(/no documents found/i);
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
