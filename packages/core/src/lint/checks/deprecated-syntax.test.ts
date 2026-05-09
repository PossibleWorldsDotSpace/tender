import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLint } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../../test/fixtures/lint");

describe("tender/deprecated-syntax", () => {
  it("flags :::name directive in content.md", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-positive"));
    const dep = r.findings.filter(f => f.code === "tender/deprecated-syntax");
    expect(dep.some(f => /:::row/.test(f.message))).toBe(true);
  });

  it("flags --- slot --- markers in content.md", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-positive"));
    const dep = r.findings.filter(f => f.code === "tender/deprecated-syntax");
    expect(dep.some(f => /response/.test(f.suggestion ?? ""))).toBe(true);
  });

  it("emits info severity for content-level deprecations", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-positive"));
    const dep = r.findings.filter(f =>
      f.code === "tender/deprecated-syntax" &&
      // Skip registry-load forwarded entries (those are already info too,
      // but stem from project.yaml; we want the content-level ones).
      /:::|---/.test(f.message)
    );
    expect(dep.every(f => f.severity === "info")).toBe(true);
  });

  it("does not fire on a project using the new syntax", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-negative"));
    expect(r.findings.filter(f => f.code === "tender/deprecated-syntax"))
      .toEqual([]);
  });
});
