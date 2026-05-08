import { describe, it, expect } from "vitest";
import { loadProjectConfig } from "./load.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../test/fixtures");

describe("loadProjectConfig", () => {
  it("loads and validates a minimal project.yaml", async () => {
    const config = await loadProjectConfig(join(fixturesDir, "minimal"));
    expect(config["page-templates"].default!.size).toBe("A5");
  });

  it("throws a helpful error when project.yaml is missing", async () => {
    await expect(loadProjectConfig(join(fixturesDir, "does-not-exist")))
      .rejects.toThrow(/project\.yaml/);
  });
});
