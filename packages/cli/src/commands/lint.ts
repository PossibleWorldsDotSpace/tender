import { runLint, hasFailures } from "@tender/core";
import type { LintReport, LintFinding } from "@tender/core";

export interface LintCliOptions {
  strict?: boolean;
  json?: boolean;
}

export interface LintCliResult {
  report: LintReport;
  exitCode: number;
}

export async function lint(
  projectDir: string,
  opts: LintCliOptions = {}
): Promise<LintCliResult> {
  const report = await runLint(projectDir);
  const exitCode = hasFailures(report, !!opts.strict) ? 1 : 0;
  return { report, exitCode };
}

/**
 * Format a LintReport for human-readable terminal output. Mirrors the
 * design plan's example: severity-prefixed lines with file:line:column,
 * the finding's message and code, and an optional indented suggestion.
 */
export function formatReport(report: LintReport, projectDir: string): string {
  if (report.findings.length === 0) return "ok";
  const lines: string[] = [];
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of report.findings) {
    counts[f.severity]++;
    const path = relPath(f.path, projectDir);
    const loc = f.line ? `:${f.line}${f.column ? `:${f.column}` : ""}` : "";
    lines.push(`${pad(f.severity)}: ${path}${loc}: ${f.message} [${f.code}]`);
    if (f.suggestion) {
      lines.push(`         suggestion: ${f.suggestion}`);
    }
  }
  lines.push("");
  lines.push(`${counts.error} errors, ${counts.warning} warnings, ${counts.info} info.`);
  return lines.join("\n");
}

function pad(severity: LintFinding["severity"]): string {
  return severity === "error"
    ? "error  "
    : severity === "warning"
    ? "warning"
    : "info   ";
}

function relPath(absolute: string, projectDir: string): string {
  if (absolute.startsWith(projectDir + "/")) return absolute.slice(projectDir.length + 1);
  return absolute;
}
