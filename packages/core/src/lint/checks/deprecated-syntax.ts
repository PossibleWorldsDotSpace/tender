import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";

/**
 * `tender/deprecated-syntax` — info-level findings for two forms in
 * document bodies and component template bodies that have replacements:
 *
 *   - `:::name` directive form → suggest `<name>...</name>`.
 *   - `--- name ---` slot markers → suggest `@@ name`.
 *
 * Split into two entry points:
 *
 *   - `checkDeprecatedSyntaxInDoc` — scans a single document body. Runs once
 *     per doc.
 *   - `checkDeprecatedSyntaxInComponents` — scans every component template
 *     body. Runs once per project; per-doc would produce N duplicates.
 *
 * The legacy YAML `templates:` block is also deprecated, but that diagnostic
 * surfaces from loadProjectRegistry directly and is forwarded by the
 * orchestrator (lint/index.ts) — no need to double-flag it here.
 */

// `^` anchored: the marker must start at column 0.
const DIRECTIVE_RE = /^:::([\w-]+)/gm;
const LEGACY_SLOT_RE = /^---\s+([\w-]+)\s+---\s*$/gm;

export interface DeprecatedSyntaxInDocInput {
  projectDir: string;
  registry: ComponentRegistry;
  contentMd: string;
  contentPath: string;
}

export interface DeprecatedSyntaxInComponentsInput {
  projectDir: string;
  registry: ComponentRegistry;
}

export function checkDeprecatedSyntaxInDoc(input: DeprecatedSyntaxInDocInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const contentPath = input.contentPath;

  // :::name directives.
  for (const m of input.contentMd.matchAll(DIRECTIVE_RE)) {
    const offset = m.index ?? 0;
    findings.push({
      code: "tender/deprecated-syntax",
      severity: "info",
      path: contentPath,
      line: lineOf(input.contentMd, offset),
      message: `Deprecated directive form ":::${m[1]}".`,
      suggestion: `Use <${m[1]} ...>...</${m[1]}> instead.`
    });
  }

  // Legacy slot markers.
  for (const m of input.contentMd.matchAll(LEGACY_SLOT_RE)) {
    const offset = m.index ?? 0;
    findings.push({
      code: "tender/deprecated-syntax",
      severity: "info",
      path: contentPath,
      line: lineOf(input.contentMd, offset),
      message: `Deprecated slot marker "--- ${m[1]} ---".`,
      suggestion: `Use @@ ${m[1]} instead.`
    });
  }

  return findings;
}

export function checkDeprecatedSyntaxInComponents(
  input: DeprecatedSyntaxInComponentsInput
): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const [name, entry] of input.registry.byName) {
    const body = entry.def.template ?? "";
    for (const m of body.matchAll(DIRECTIVE_RE)) {
      findings.push({
        code: "tender/deprecated-syntax",
        severity: "info",
        path: entry.source.path,
        message: `Deprecated directive form ":::${m[1]}" inside component "${name}".`,
        suggestion: `Use <${m[1]} ...>...</${m[1]}> instead.`
      });
    }
    for (const m of body.matchAll(LEGACY_SLOT_RE)) {
      findings.push({
        code: "tender/deprecated-syntax",
        severity: "info",
        path: entry.source.path,
        message: `Deprecated slot marker inside component "${name}".`,
        suggestion: `Use @@ ${m[1]} instead.`
      });
    }
  }

  return findings;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}
