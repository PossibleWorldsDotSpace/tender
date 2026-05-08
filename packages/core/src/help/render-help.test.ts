import { describe, it, expect } from "vitest";
import { renderHelp } from "./render-help.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../test/fixtures");

describe("renderHelp", () => {
  it("renders a project's docs/user-guide.md when present", async () => {
    const result = await renderHelp(join(fixturesDir, "with-user-guide"));
    expect(result.source).toBe("project");
    expect(result.html).toContain("<h1>Project guide</h1>");
  });

  it("falls back to the built-in user guide when project has none", async () => {
    const result = await renderHelp(join(fixturesDir, "hello"));
    expect(result.source).toBe("builtin");
    expect(result.html).toContain("Tender User Guide");
  });
});
