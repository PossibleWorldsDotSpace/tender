import { describe, it, expect } from "vitest";
import type { LintReport, LintFinding } from "./report.js";
import { hasFailures } from "./report.js";

const finding = (severity: LintFinding["severity"]): LintFinding => ({
  code: "tender/unused-component",
  severity,
  path: "/p/x.tender",
  message: "x"
});

describe("LintReport.hasFailures", () => {
  it("returns true when any finding is an error", () => {
    const r: LintReport = { findings: [finding("error"), finding("info")] };
    expect(hasFailures(r, false)).toBe(true);
  });

  it("returns false when there are only warnings or info", () => {
    const r: LintReport = { findings: [finding("warning"), finding("info")] };
    expect(hasFailures(r, false)).toBe(false);
  });

  it("strict mode promotes warnings", () => {
    const r: LintReport = { findings: [finding("warning")] };
    expect(hasFailures(r, true)).toBe(true);
  });

  it("strict mode does not promote info", () => {
    const r: LintReport = { findings: [finding("info")] };
    expect(hasFailures(r, true)).toBe(false);
  });

  it("returns false on an empty report", () => {
    expect(hasFailures({ findings: [] }, true)).toBe(false);
  });
});
