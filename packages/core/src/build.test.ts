import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildProject } from "./build.js";
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

  it("coastal-planet fixture: HTML output is structurally stable", async () => {
    const result = await buildProject(join(fixturesDir, "coastal-planet"));
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

  it("coastal-planet-tender fixture: same structural markers via the .tender pipeline", async () => {
    const result = await buildProject(join(fixturesDir, "coastal-planet-tender"));
    expect(result.html).toContain('class="row"');
    expect(result.html).toContain('class="spanning-row"');
    expect(result.html).toContain('class="ad-lib');
    expect(result.html).toContain('class="yellow-tag"');
    expect(result.html).toContain('class="speaker-name"');
    expect(result.html).toContain('data-page-template="cover"');
    expect(result.html).not.toContain("<p>:::</p>");
    expect(result.html).not.toContain("--- suggested ---");
  });
});
