import { parseTagNames } from "../../parse/try-parse-tag.js";
import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";

/**
 * `tender/unknown-component` — error on a tag invocation referencing a name
 * that's not registered. Mirrors the LSP's diagnostic check from the
 * editor pane; in CLI form it catches the same drift before a build runs.
 *
 * Built-in components (page) and HTML-shaped tags inside template bodies
 * are excluded — the latter because component templates legitimately emit
 * raw HTML like <div> and <img>.
 *
 * For now, we only flag from content.md. A future iteration could extend
 * to component template bodies, but the heuristic for "raw HTML vs. tag-
 * syntax invocation" inside a template is fuzzy enough that v1 stays
 * conservative.
 */

const BUILTIN_NAMES = new Set(["page"]);

export interface UnknownComponentInput {
  projectDir: string;
  registry: ComponentRegistry;
  contentMd: string;
  contentPath: string;
}

export function checkUnknownComponent(input: UnknownComponentInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const known = new Set([
    ...BUILTIN_NAMES,
    ...input.registry.byName.keys()
  ]);
  const seen = new Set<string>();
  for (const name of parseTagNames(input.contentMd)) {
    // Tags whose names match the HTML "void elements" or common HTML tags
    // that a Markdown author might inline as raw HTML are not flagged —
    // we'd rather under-report than nag. The tag scanner only surfaces
    // names matching [a-zA-Z][a-zA-Z0-9-]*, which includes plain `div`
    // etc. Use a simple heuristic: hyphenated names are component-like
    // (custom-elements convention); single-word lowercase names are HTML.
    if (known.has(name)) continue;
    if (!name.includes("-")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    findings.push({
      code: "tender/unknown-component",
      severity: "error",
      path: input.contentPath,
      message: `Unknown component "${name}".`,
      suggestion: `Declare it in components/${name}.tender or remove the reference.`
    });
  }
  return findings;
}
