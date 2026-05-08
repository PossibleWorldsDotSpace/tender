import { describe, it, expect } from "vitest";
import { lint } from "./lint.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../core/test/fixtures");

describe("lint command", () => {
  it("returns success on a valid project", async () => {
    const result = await lint(join(fixturesDir, "hello"));
    expect(result.errors).toEqual([]);
  });

  it("reports unknown component errors", async () => {
    const result = await lint(join(fixturesDir, "broken"));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/unknown component/i);
  });

  it("includes file:line in error messages", async () => {
    const result = await lint(join(fixturesDir, "broken"));
    expect(result.errors[0]).toMatch(/content\.md:\d+/);
  });

  it("reports missing project.yaml as an error", async () => {
    const result = await lint(join(fixturesDir, "does-not-exist"));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/project\.yaml/);
  });
});
