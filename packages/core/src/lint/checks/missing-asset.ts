import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";

/**
 * `tender/missing-asset` — error on a relative `src=`/`href=`/Markdown image
 * reference that points at a non-existent file.
 *
 * Split into two entry points:
 *
 *   - `checkMissingAssetInDoc` — scans Markdown image syntax and inline HTML
 *     `src=`/`href=` in a single document body. Runs once per doc.
 *   - `checkMissingAssetInComponents` — scans every component template body.
 *     Runs once per project; doing this per-doc would produce N duplicates of
 *     each template-level finding.
 *
 * Skips http(s)/data:/mailto:/#anchor URIs. Handlebars-templated paths
 * (e.g. `assets/{{icon}}.png`) are not resolved — that's a v2 concern
 * requiring param-value enumeration.
 */

const SRC_ATTR_RE = /(?:src|href)\s*=\s*"([^"]+)"|(?:src|href)\s*=\s*'([^']+)'/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)/g;
const SKIPPED_PROTOCOLS = /^(?:https?:|data:|mailto:|#)/;
// Handlebars-interpolated path; defer to v2.
const HANDLEBARS_INTERPOLATION = /\{\{/;

export interface MissingAssetInDocInput {
  projectDir: string;
  registry: ComponentRegistry;
  contentMd: string;
  contentPath: string;
}

export interface MissingAssetInComponentsInput {
  projectDir: string;
  registry: ComponentRegistry;
}

export async function checkMissingAssetInDoc(input: MissingAssetInDocInput): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];

  // Markdown image references.
  for (const m of input.contentMd.matchAll(MD_IMAGE_RE)) {
    const ref = m[1]!;
    if (shouldSkip(ref)) continue;
    const refPath = isAbsolute(ref) ? ref : join(input.projectDir, ref);
    const exists = await stat(refPath).then(() => true).catch(() => false);
    if (!exists) {
      findings.push({
        code: "tender/missing-asset",
        severity: "error",
        path: input.contentPath,
        message: `Missing asset "${ref}".`
      });
    }
  }

  // Inline HTML src=/href= attributes too — authors sometimes drop straight
  // HTML for one-off assets.
  for (const ref of collectAttrRefs(input.contentMd)) {
    if (shouldSkip(ref)) continue;
    const refPath = isAbsolute(ref) ? ref : join(input.projectDir, ref);
    const exists = await stat(refPath).then(() => true).catch(() => false);
    if (!exists) {
      findings.push({
        code: "tender/missing-asset",
        severity: "error",
        path: input.contentPath,
        message: `Missing asset "${ref}".`
      });
    }
  }

  return findings;
}

export async function checkMissingAssetInComponents(
  input: MissingAssetInComponentsInput
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];

  for (const [name, entry] of input.registry.byName) {
    const body = entry.def.template ?? "";
    const refs = collectAttrRefs(body);
    for (const ref of refs) {
      if (shouldSkip(ref)) continue;
      const refPath = isAbsolute(ref) ? ref : join(input.projectDir, ref);
      const exists = await stat(refPath).then(() => true).catch(() => false);
      if (!exists) {
        findings.push({
          code: "tender/missing-asset",
          severity: "error",
          path: entry.source.path,
          message: `Component "${name}" references missing asset "${ref}".`
        });
      }
    }
  }

  return findings;
}

function shouldSkip(ref: string): boolean {
  if (SKIPPED_PROTOCOLS.test(ref)) return true;
  if (HANDLEBARS_INTERPOLATION.test(ref)) return true;
  return false;
}

function collectAttrRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(SRC_ATTR_RE)) {
    out.push((m[1] ?? m[2])!);
  }
  return out;
}
