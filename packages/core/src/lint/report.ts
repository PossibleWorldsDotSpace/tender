/**
 * Lint report types and exit-code policy.
 *
 * v1 ships three structural checks. `tender/declared-slot-never-filled` is
 * descoped because the build-time slot validator already enforces that every
 * declared slot be filled at every invocation — a "declared but never filled"
 * warning therefore only fires on components that are entirely unused, which
 * `tender/unused-component` already catches. Tracked as a deferred GH issue.
 */
export type LintCode =
  | "tender/unused-component"
  | "tender/missing-asset"
  | "tender/deprecated-syntax";

export interface LintFinding {
  code: LintCode;
  severity: "error" | "warning" | "info";
  /** Absolute path of the source file the finding applies to. */
  path: string;
  /** 1-indexed line number, when known. */
  line?: number;
  /** 1-indexed column, when known. */
  column?: number;
  message: string;
  /** One-line suggestion for users; LSP can render as a Code Action later. */
  suggestion?: string;
}

export interface LintReport {
  findings: LintFinding[];
}

/**
 * Decide whether a report represents a build failure. Errors always fail;
 * warnings only fail under --strict (CI gating); info never fails.
 */
export function hasFailures(report: LintReport, strict: boolean): boolean {
  for (const f of report.findings) {
    if (f.severity === "error") return true;
    if (strict && f.severity === "warning") return true;
  }
  return false;
}
