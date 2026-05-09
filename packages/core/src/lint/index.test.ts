import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLint } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../test/fixtures/lint");

describe("runLint orchestrator", () => {
  it("returns an empty report for a project with no components and no content references", async () => {
    const report = await runLint(join(fixtures, "empty"));
    expect(report.findings).toEqual([]);
  });
});
