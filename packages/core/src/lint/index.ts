import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProjectRegistry } from "../parse/load-project-registry.js";
import { checkUnusedComponent } from "./checks/unused-component.js";
import { checkMissingAsset } from "./checks/missing-asset.js";
import { checkDeprecatedSyntax } from "./checks/deprecated-syntax.js";
import type { LintFinding, LintReport } from "./report.js";

/**
 * Run all v1 lint checks against a project. Always succeeds; check failures
 * fold into LintReport.findings. The CLI decides whether the report
 * represents an exit-code failure via the `hasFailures` helper.
 *
 * Each check is invoked from this orchestrator with a shared input object
 * (registry + parsed content). Future checks (CSS-aware, etc.) plug in
 * here.
 */
export async function runLint(projectDir: string): Promise<LintReport> {
  const findings: LintFinding[] = [];
  const { registry } = await loadProjectRegistry(projectDir);
  const contentMd = await readFile(join(projectDir, "content.md"), "utf8")
    .catch(() => "");

  // Forward registry-load diagnostics (e.g. yaml-component deprecation,
  // inline-shortcut validation errors) as lint findings so users see them
  // in `tender lint` output.
  for (const d of registry.diagnostics) {
    findings.push({
      code: "tender/deprecated-syntax",
      severity: d.severity === "error" ? "error" : "info",
      path: d.source?.path ?? join(projectDir, "project.yaml"),
      message: d.message
    });
  }

  findings.push(...checkUnusedComponent({ registry, contentMd }));
  findings.push(...await checkMissingAsset({ projectDir, registry, contentMd }));
  findings.push(...checkDeprecatedSyntax({ projectDir, registry, contentMd }));

  return { findings };
}

export type { LintReport, LintFinding, LintCode } from "./report.js";
export { hasFailures } from "./report.js";
