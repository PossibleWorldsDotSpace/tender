import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProjectRegistry } from "../parse/load-project-registry.js";
import { listDocuments } from "../parse/list-documents.js";
import type { ProjectDocument } from "../parse/list-documents.js";
import { parseTagNames } from "../parse/try-parse-tag.js";
import { checkUnusedComponent } from "./checks/unused-component.js";
import { checkUnknownComponent } from "./checks/unknown-component.js";
import {
  checkMissingAssetInDoc,
  checkMissingAssetInComponents
} from "./checks/missing-asset.js";
import {
  checkDeprecatedSyntaxInDoc,
  checkDeprecatedSyntaxInComponents
} from "./checks/deprecated-syntax.js";
import { checkTokens } from "./checks/tokens.js";
import type { LintFinding, LintReport } from "./report.js";

/**
 * Run all v1 lint checks against a project. Always succeeds; check failures
 * fold into LintReport.findings. The CLI decides whether the report
 * represents an exit-code failure via the `hasFailures` helper.
 *
 * Per-document checks (unknown-component, missing-asset-in-doc,
 * deprecated-syntax-in-doc) run once per `*.md` document discovered at the
 * project root. Component-template scans (missing-asset-in-components,
 * deprecated-syntax-in-components) run exactly once per project — running
 * them per-doc would emit N duplicate findings for any template-level issue.
 *
 * The cross-doc `unused-component` check receives a Set of tag names parsed
 * from each doc separately, so a half-tag at the end of one doc cannot fuse
 * with the start of the next during reachability analysis.
 */
export async function runLint(projectDir: string): Promise<LintReport> {
  const findings: LintFinding[] = [];
  let registry;
  let config;
  try {
    ({ registry, config } = await loadProjectRegistry(projectDir));
  } catch (err) {
    return {
      findings: [{
        code: "tender/project-config",
        severity: "error",
        path: join(projectDir, "project.yaml"),
        message: err instanceof Error ? err.message : String(err)
      }]
    };
  }

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

  // Read every root document in parallel. listDocuments returns content.md
  // first if present.
  const docs = await listDocuments(projectDir);
  const docContents: { doc: ProjectDocument; md: string }[] = await Promise.all(
    docs.map(async doc => ({
      doc,
      md: await readFile(doc.path, "utf8").catch(() => "")
    }))
  );

  // Per-doc checks: run each once per doc, attaching the doc's path so
  // findings carry the right filename. CPU-bound regex work — keep serial.
  for (const { doc, md } of docContents) {
    findings.push(...checkUnknownComponent({ projectDir, registry, contentMd: md, contentPath: doc.path }));
    findings.push(...await checkMissingAssetInDoc({ projectDir, registry, contentMd: md, contentPath: doc.path }));
    findings.push(...checkDeprecatedSyntaxInDoc({ projectDir, registry, contentMd: md, contentPath: doc.path }));
  }

  // Project-wide checks: component-template scans run exactly once.
  findings.push(...await checkMissingAssetInComponents({ projectDir, registry }));
  findings.push(...checkDeprecatedSyntaxInComponents({ projectDir, registry }));

  // Cross-doc reachability: parse each doc separately so a half-tag at the
  // end of one doc cannot fuse with the start of the next.
  const referencedNames = new Set<string>();
  for (const { md } of docContents) {
    for (const name of parseTagNames(md)) referencedNames.add(name);
  }
  findings.push(...checkUnusedComponent({ registry, referencedNames }));

  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8")
    .catch(() => "");
  const consumedCss = stylesCss + "\n" + registry.combinedCss;
  findings.push(...checkTokens({ projectDir, tokens: config["design-tokens"], consumedCss }));

  return { findings };
}

export type { LintReport, LintFinding, LintCode } from "./report.js";
export { hasFailures } from "./report.js";
