import { join } from "node:path";
import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";

/**
 * `tender/deprecated-syntax` — info-level findings for two forms in
 * content.md and component template bodies that have replacements:
 *
 *   - `:::name` directive form → suggest `<name>...</name>`.
 *   - `--- name ---` slot markers → suggest `@@ name`.
 *
 * The legacy YAML `templates:` block is also deprecated, but that
 * diagnostic surfaces from loadProjectRegistry directly and is forwarded
 * by the orchestrator (lint/index.ts) — no need to double-flag it here.
 */

// `^` anchored: the marker must start at column 0.
const DIRECTIVE_RE = /^:::([\w-]+)/gm;
const LEGACY_SLOT_RE = /^---\s+([\w-]+)\s+---\s*$/gm;

export interface DeprecatedSyntaxInput {
  projectDir: string;
  registry: ComponentRegistry;
  contentMd: string;
}

export function checkDeprecatedSyntax(input: DeprecatedSyntaxInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const contentPath = join(input.projectDir, "content.md");

  // 1. :::name directives in content.md.
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

  // 2. Legacy slot markers in content.md.
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

  // 3. Same scans across component template bodies.
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
