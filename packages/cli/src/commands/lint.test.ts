import { describe, it, expect } from "vitest";
import { lint, formatReport } from "./lint.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../core/test/fixtures");

describe("lint command", () => {
  it("returns exit code 0 on a clean project", async () => {
    const { report, exitCode } = await lint(join(fixturesDir, "hello"));
    expect(report.findings).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("returns exit code 0 on a project that uses the new syntax", async () => {
    const { report, exitCode } = await lint(join(fixturesDir, "lint/empty"));
    expect(report.findings).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("flags unknown components in content.md", async () => {
    const { report, exitCode } = await lint(join(fixturesDir, "lint/unknown-component-positive"));
    const unknown = report.findings.filter(f => f.code === "tender/unknown-component");
    expect(unknown.length).toBeGreaterThan(0);
    expect(exitCode).toBe(1);
  });

  it("--strict promotes warnings to non-zero exit", async () => {
    // unused-component-positive produces a warning (no errors). Default
    // exit code is 0; --strict makes it 1.
    const def = await lint(join(fixturesDir, "lint/unused-component-positive"));
    expect(def.exitCode).toBe(0);
    const strict = await lint(join(fixturesDir, "lint/unused-component-positive"), { strict: true });
    expect(strict.exitCode).toBe(1);
  });

  it("formatReport produces 'ok' for an empty report", () => {
    const text = formatReport({ findings: [] }, "/p");
    expect(text).toBe("ok");
  });

  it("formatReport produces severity-prefixed lines", () => {
    const text = formatReport({
      findings: [
        {
          code: "tender/unused-component",
          severity: "warning",
          path: "/p/components/x.tender",
          message: 'Component "x" is declared but never used.'
        }
      ]
    }, "/p");
    expect(text).toMatch(/warning.*components\/x\.tender.*unused-component/);
  });

  it("formatReport renders suggestions on indented continuation lines", () => {
    const text = formatReport({
      findings: [
        {
          code: "tender/deprecated-syntax",
          severity: "info",
          path: "/p/content.md",
          line: 5,
          message: "Deprecated.",
          suggestion: "Use the new form."
        }
      ]
    }, "/p");
    expect(text).toContain("info");
    expect(text).toContain("content.md:5:");
    expect(text).toMatch(/suggestion: Use the new form\./);
  });
});
