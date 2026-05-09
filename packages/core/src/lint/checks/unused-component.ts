import { parseTagNames } from "../../parse/try-parse-tag.js";
import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";

/**
 * `tender/unused-component` — warn on a component declared but unreferenced.
 *
 * Reachability-based: starts from tag references in content.md, then walks
 * through reached components' template bodies marking any tags they emit
 * (e.g. an outer component referencing an inner). Components not reached by
 * any walk are unused.
 *
 * Built-in components (page) are never flagged — they're always reachable.
 */

const BUILTIN_NAMES = new Set(["page"]);

export interface UnusedComponentInput {
  registry: ComponentRegistry;
  contentMd: string;
}

export function checkUnusedComponent(input: UnusedComponentInput): LintFinding[] {
  const referenced = new Set<string>();

  // Seed: tag names referenced in content.md.
  for (const name of parseTagNames(input.contentMd)) referenced.add(name);

  // Walk closures: a component's template body may reference other
  // components. Repeat until no new names get added.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of input.registry.byName) {
      if (!referenced.has(name)) continue;
      const body = entry.def.template ?? "";
      for (const ref of parseTagNames(body)) {
        if (!referenced.has(ref)) {
          referenced.add(ref);
          changed = true;
        }
      }
    }
  }

  const findings: LintFinding[] = [];
  for (const [name, entry] of input.registry.byName) {
    if (BUILTIN_NAMES.has(name)) continue;
    if (referenced.has(name)) continue;
    findings.push({
      code: "tender/unused-component",
      severity: "warning",
      path: entry.source.path,
      message: `Component "${name}" is declared but never used.`
    });
  }
  return findings;
}
