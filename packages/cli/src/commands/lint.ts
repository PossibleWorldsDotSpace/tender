import { runLint, hasFailures } from "@tender/core";
import type { LintReport, LintFinding } from "@tender/core";
import { red, yellow, dim, cyan, bold, green } from "../ui/style.js";

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
 *
 * Color is layered on via ../ui/style — those helpers no-op under
 * NO_COLOR / non-TTY / CI, so this function emits the same plain-text
 * structure in those environments. Tests assert against the plain text.
 */
export function formatReport(report: LintReport, projectDir: string): string {
  if (report.findings.length === 0) return green("ok");
  const lines: string[] = [];
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of report.findings) {
    counts[f.severity]++;
    const path = relPath(f.path, projectDir);
    const loc = f.line ? `:${f.line}${f.column ? `:${f.column}` : ""}` : "";
    const sev = colorSeverity(f.severity);
    const where = `${cyan(path)}${dim(loc)}`;
    const code = dim(`[${f.code}]`);
    lines.push(`${sev}: ${where}: ${f.message} ${code}`);
    if (f.suggestion) {
      lines.push(`         ${dim("suggestion:")} ${f.suggestion}`);
    }
  }
  lines.push("");
  lines.push(summaryLine(counts));
  return lines.join("\n");
}

function pad(severity: LintFinding["severity"]): string {
  return severity === "error"
    ? "error  "
    : severity === "warning"
    ? "warning"
    : "info   ";
}

function colorSeverity(severity: LintFinding["severity"]): string {
  const text = pad(severity);
  if (severity === "error") return red(bold(text));
  if (severity === "warning") return yellow(text);
  return dim(text);
}

function summaryLine(counts: { error: number; warning: number; info: number }): string {
  const errs = counts.error === 0 ? `${counts.error} errors` : red(`${counts.error} errors`);
  const warns = counts.warning === 0 ? `${counts.warning} warnings` : yellow(`${counts.warning} warnings`);
  const info = dim(`${counts.info} info`);
  return `${errs}, ${warns}, ${info}.`;
}

function relPath(absolute: string, projectDir: string): string {
  if (absolute.startsWith(projectDir + "/")) return absolute.slice(projectDir.length + 1);
  return absolute;
}
