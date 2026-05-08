import { describe, it, expect } from "vitest";
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
});
