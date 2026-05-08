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
});
