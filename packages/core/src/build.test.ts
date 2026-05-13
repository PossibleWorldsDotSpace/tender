import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildProject, buildProjectAll } from "./build.js";
import { cleanText } from "./clean/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../test/fixtures");

describe("buildProject", () => {
  it("returns html, projectCss, stylesCss, and config", async () => {
    const result = await buildProject(join(fixturesDir, "hello"));
    expect(result.html).toContain("<h1>Hello, Tender</h1>");
    expect(result.html).toContain('href="_project.css"');
    expect(result.projectCss).toContain("@page default");
    expect(result.stylesCss).toContain("font-family: serif");
    expect(result.config["page-templates"].default!.size).toBe("A5");
  });

  it("builds a project that uses components and templates", async () => {
    const result = await buildProject(join(fixturesDir, "components"));
    expect(result.html).toContain('class="callout"');
    expect(result.html).toContain('data-variant="warning"');
    expect(result.html).toContain('class="row"');
    expect(result.html).toContain('class="col-l"');
  });

  it("page-templates fixture: html marks chapter-opener page and CSS has both @page rules", async () => {
    const result = await buildProject(join(fixturesDir, "page-templates"));
    expect(result.html).toContain('data-page-template="chapter-opener"');
    expect(result.projectCss).toContain("@page chapter-opener");
    expect(result.projectCss).toContain("@page chapter-opener:first");
    expect(result.projectCss).toContain("@page default");
  });

  it("with-image fixture: builds without errors and image is referenced in HTML", async () => {
    const result = await buildProject(join(fixturesDir, "with-image"));
    expect(result.html).toContain('src="assets/images/dot.png"');
  });

  it("populates componentsCss from .tender component <style> blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-build-"));
    try {
      await writeFile(
        join(dir, "project.yaml"),
        "page-templates: { default: { size: A5, margin: 0 } }\n"
      );
      await writeFile(join(dir, "content.md"), "# Hello\n");
      await mkdir(join(dir, "components"), { recursive: true });
      await writeFile(
        join(dir, "components", "widget.tender"),
        [
          "---", "tag: div", "---", "",
          "<style>", ".widget { color: red; }", "</style>"
        ].join("\n")
      );
      const result = await buildProject(dir);
      expect(result.componentsCss).toContain(".widget { color: red; }");
      // The composed HTML references the new stylesheet.
      expect(result.html).toContain('href="_components.css"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty componentsCss when a project has no .tender files", async () => {
    const result = await buildProject(join(fixturesDir, "hello"));
    expect(result.componentsCss).toBe("");
  });

  it("open-circle fixture: HTML output is structurally stable", async () => {
    const result = await buildProject(join(fixturesDir, "open-circle"));
    expect(result.html).toContain('class="row"');
    expect(result.html).toContain('class="spanning-row"');
    expect(result.html).toContain('class="ad-lib');
    expect(result.html).toContain('class="yellow-tag"');
    expect(result.html).toContain('class="speaker-name"');
    expect(result.html).toContain('data-page-template="cover"');
    // No unrendered directive sentinels should leak through.
    expect(result.html).not.toContain("<p>:::</p>");
    expect(result.html).not.toContain("--- suggested ---");
  });

  it("open-circle-tender fixture: same structural markers via the .tender pipeline", async () => {
    const result = await buildProject(join(fixturesDir, "open-circle-tender"));
    expect(result.html).toContain('class="row"');
    expect(result.html).toContain('class="spanning-row"');
    expect(result.html).toContain('class="ad-lib');
    expect(result.html).toContain('class="yellow-tag"');
    expect(result.html).toContain('class="speaker-name"');
    expect(result.html).toContain('data-page-template="cover"');
    expect(result.html).not.toContain("<p>:::</p>");
    expect(result.html).not.toContain("--- suggested ---");
  });

  it("open-circle-tags fixture: same structural markers via tag-syntax invocation", async () => {
    const result = await buildProject(join(fixturesDir, "open-circle-tags"));
    expect(result.html).toContain('class="row"');
    expect(result.html).toContain('class="spanning-row"');
    expect(result.html).toContain('class="ad-lib');
    expect(result.html).toContain('class="yellow-tag"');
    expect(result.html).toContain('class="speaker-name"');
    expect(result.html).toContain('data-page-template="cover"');
    expect(result.html).not.toContain("<p>:::</p>");
    expect(result.html).not.toContain("--- suggested ---");
  });

  it("open-circle-shortcuts fixture: inline shortcuts expand into component tags", async () => {
    const result = await buildProject(join(fixturesDir, "open-circle-shortcuts"));
    // The | shortcut should expand into <span class="stage-direction">…</span>.
    expect(result.html).toContain('class="stage-direction"');
    // The literal | character should not appear adjacent to its content
    // (i.e. the shortcut got fully expanded).
    expect(result.html).not.toContain("|Facilitator A stands");
    expect(result.html).not.toContain("|Holds up the small stone");
    // Sanity: structural markers still present.
    expect(result.html).toContain('class="row"');
    expect(result.html).toContain('data-page-template="cover"');
  });

  it("design-tokens fixture: tokens appear in projectCss before user styles", async () => {
    const result = await buildProject(join(fixturesDir, "design-tokens"));
    expect(result.projectCss).toContain("--color-ink: #1a1a1a;");
    expect(result.projectCss).toContain("--color-page: #ffffff;");
    expect(result.projectCss).toContain("--size-body: 11pt;");
    // user CSS is separate — its var() references are preserved verbatim
    expect(result.stylesCss).toContain("var(--color-ink)");
  });

  it("open-circle-paste-artifact: cleanText restores paste-artifact content to expected", async () => {
    // The fixture's content.md is a copy of open-circle-tags' content.md
    // with deliberately-introduced paste artifacts (BOM, NBSP, soft hyphen,
    // zero-width space, trailing whitespace, CRLF line endings). After
    // cleaning, the output should be byte-identical to the hand-saved
    // expected file (which is the original, clean version).
    const dir = join(fixturesDir, "open-circle-paste-artifact");
    const dirty = await readFile(join(dir, "content.md"), "utf8");
    const expected = await readFile(join(dir, "content-expected.md"), "utf8");
    const r = await cleanText(dirty);
    expect(r.output).toBe(expected);
    // Sanity: the cleaner did meaningful work.
    expect(r.changes.length).toBeGreaterThanOrEqual(5);
  });

  async function fixture(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "tender-build-"));
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(dir, name), contents);
    }
    return dir;
  }

  it("builds the named document when opts.docName is given", async () => {
    const dir = await fixture({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Should not be picked",
      "resume.md": "# Resume"
    });
    const result = await buildProject(dir, { docName: "resume" });
    expect(result.html).toContain("Resume");
    expect(result.docBasename).toBe("resume");
    expect(result.docFilename).toBe("resume.md");
  });

  it("defaults to content.md when opts is omitted", async () => {
    const dir = await fixture({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Hi"
    });
    const result = await buildProject(dir);
    expect(result.docBasename).toBe("content");
    expect(result.html).toContain("Hi");
  });

  it("throws a clear error when the named doc doesn't exist", async () => {
    const dir = await fixture({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Hi"
    });
    await expect(buildProject(dir, { docName: "missing" })).rejects.toThrow(/no document.*missing/i);
  });

  it("build errors reference the actual document filename, not content.md", async () => {
    // Regression: positionPrefix used to hard-code "content.md", so an
    // Unknown-component error in resume.md was reported as `content.md:N:N`.
    const dir = await fixture({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Hi",
      "resume.md": ":::definitely-not-real\noops\n:::\n"
    });
    await expect(buildProject(dir, { docName: "resume" })).rejects.toThrow(/resume\.md:\d+/);
    await expect(buildProject(dir, { docName: "resume" })).rejects.not.toThrow(/content\.md:\d+/);
  });

  it("rethrows non-ENOENT read errors instead of wrapping them as missing-doc", async () => {
    const dir = await fixture({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": ""
    });
    // Create a directory where content.md should be — readFile will throw EISDIR.
    await mkdir(join(dir, "content.md"));
    await expect(buildProject(dir)).rejects.toThrow(/EISDIR|illegal operation/i);
  });

  it("buildProjectAll returns one result per document, sorted with content.md first", async () => {
    const dir = await fixture({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": "",
      "content.md": "# Default",
      "resume.md": "# Resume",
      "cover-letter.md": "# Cover"
    });
    const results = await buildProjectAll(dir);
    expect(results.map(r => r.docBasename)).toEqual(["content", "cover-letter", "resume"]);
  });

  it("buildProjectAll returns [] when no documents exist", async () => {
    const dir = await fixture({
      "project.yaml": "page-templates:\n  default:\n    size: A4\n    margin: 0\n",
      "styles.css": ""
    });
    const results = await buildProjectAll(dir);
    expect(results).toEqual([]);
  });

  it("multi-doc fixture: every *.md builds and shares the same component registry", async () => {
    const dir = join(fixturesDir, "multi-doc");
    const results = await buildProjectAll(dir);
    expect(results.map(r => r.docBasename)).toEqual(["content", "cover-letter", "resume"]);
    for (const r of results) {
      expect(r.html).toContain("<html");
      // Every doc references <highlight>; the shared registry resolves it to a <span class="highlight">.
      expect(r.html).toContain('class="highlight"');
      // Project CSS is identical across docs (same registry).
      expect(r.componentsCss).toBe(results[0]!.componentsCss);
    }
  });
});
