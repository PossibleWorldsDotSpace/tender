import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLint } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../../test/fixtures/lint");

describe("tender/unused-component", () => {
  it("fires on a declared but unreferenced component", async () => {
    const r = await runLint(join(fixtures, "unused-component-positive"));
    const unused = r.findings.filter(f => f.code === "tender/unused-component");
    expect(unused.length).toBe(1);
    expect(unused[0]?.path).toMatch(/never-used\.tender$/);
    expect(unused[0]?.severity).toBe("warning");
  });

  it("does not fire on a referenced component", async () => {
    const r = await runLint(join(fixtures, "unused-component-negative"));
    expect(r.findings.filter(f => f.code === "tender/unused-component"))
      .toEqual([]);
  });

  it("does not fire transitively when an outer component references the inner", async () => {
    const r = await runLint(join(fixtures, "unused-component-transitive"));
    expect(r.findings.filter(f => f.code === "tender/unused-component"))
      .toEqual([]);
  });

  it("fires on both components when both are transitively unreachable", async () => {
    const r = await runLint(join(fixtures, "unused-component-transitive-unreachable"));
    const unused = r.findings.filter(f => f.code === "tender/unused-component");
    expect(unused.length).toBe(2);
    const paths = unused.map(f => f.path).sort();
    expect(paths[0]).toMatch(/inner\.tender$/);
    expect(paths[1]).toMatch(/outer\.tender$/);
  });

  it("never fires on the page built-in", async () => {
    // Even with the empty fixture (no <page> usage), the built-in shouldn't
    // surface as unused.
    const r = await runLint(join(fixtures, "empty"));
    const unused = r.findings.filter(f => f.code === "tender/unused-component");
    expect(unused.find(f => /page/.test(f.message))).toBeUndefined();
  });
});
