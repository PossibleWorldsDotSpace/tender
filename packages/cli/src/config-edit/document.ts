/**
 * AST-preserving read/edit layer for `project.yaml`. Every write goes
 * through `yaml`'s Document so comments and unrelated keys survive — the
 * same technique `commands/tokens.ts` uses for single-token edits, lifted
 * to the structured edits the configurator needs (page size, margin,
 * design tokens), plus a conflict-resolution and diff layer on top.
 *
 * No interactivity here. The TUI screens (later slices) collect answers
 * and hand them to `applyEdits`; this module is the pure, testable engine.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import type { Document } from "yaml";
import {
  formatMargin,
  formatPageSize,
  type MarginValue,
  type PageSizeValue
} from "./values.js";

/** Path to a project's config file. */
export function projectYamlPath(projectDir: string): string {
  return join(projectDir, "project.yaml");
}

/** Parse a project.yaml source string into an editable Document. */
export function parseProjectDocument(src: string): Document {
  return parseDocument(src);
}

export async function readProjectDocument(projectDir: string): Promise<{
  doc: Document;
  src: string;
}> {
  const src = await readFile(projectYamlPath(projectDir), "utf8");
  return { doc: parseDocument(src), src };
}

/**
 * One foundational edit. `value === undefined` means "the user left this
 * field unchanged" — in merge mode it's a no-op; it never deletes a key.
 * Deletion isn't a configurator concern (you don't remove `size` via a
 * wizard), so the absence of an edit and an explicit clear are the same:
 * leave the document alone.
 */
/** A single header/footer marginal-box config. The schema accepts either the
 * literal string `"none"` (suppresses the row) or a `{left?, center?, right?}`
 * map. Verso/recto (`headers-rest` / `footers-rest`) is deferred to #18. */
export type HeaderFooterValue =
  | "none"
  | { left?: string; center?: string; right?: string };

export type Edit =
  | { kind: "page-size"; template: string; value: PageSizeValue | undefined }
  | { kind: "page-margin"; template: string; value: MarginValue | undefined }
  | { kind: "page-headers"; template: string; value: HeaderFooterValue | undefined }
  | { kind: "page-footers"; template: string; value: HeaderFooterValue | undefined }
  /** Create a whole new page template. `value` carries the minimum required
   * fields (size + margin) per the schema; further config (headers, footers,
   * bleed) lands as separate edits in the same batch, keyed by the new name. */
  | {
      kind: "page-template-add";
      template: string;
      value: { size: PageSizeValue; margin: MarginValue } | undefined;
    }
  | {
      kind: "token";
      category: string;
      name: string;
      value: string | number | undefined;
    };

export type ConflictMode = "merge" | "reset";

/**
 * Apply edits to a Document in place.
 *
 * - `merge` (default): an edit with a defined `value` overwrites that key;
 *   an edit with `value === undefined` is skipped (keeps current). Keys not
 *   mentioned by any edit are never touched. This single rule gives the
 *   user-facing behaviours we promised: Enter-through ⇒ all undefined ⇒
 *   no-op; change-some ⇒ partial overwrite; untouched keys ⇒ preserved.
 * - `reset`: same, except a defined value always overwrites even if equal,
 *   and callers are expected to pass defaults for every field (the
 *   "redo from scratch" path). Comments still survive — only mapped values
 *   are replaced, the Document's comment nodes are untouched.
 *
 * Returns the count of keys actually changed (for "N edits" messaging).
 */
export function applyEdits(
  doc: Document,
  edits: Edit[],
  mode: ConflictMode = "merge"
): number {
  let changed = 0;
  for (const edit of edits) {
    if (edit.value === undefined) continue; // unchanged field — never deletes

    let path: (string | number)[];
    let next: unknown;

    switch (edit.kind) {
      case "page-size":
        path = ["page-templates", edit.template, "size"];
        next = formatPageSize(edit.value);
        break;
      case "page-margin":
        path = ["page-templates", edit.template, "margin"];
        next = formatMargin(edit.value);
        break;
      case "page-headers":
        path = ["page-templates", edit.template, "headers"];
        next = edit.value;
        break;
      case "page-footers":
        path = ["page-templates", edit.template, "footers"];
        next = edit.value;
        break;
      case "page-template-add":
        // Whole-template create. In merge mode we never clobber an existing
        // template (the configurator is "add" semantics; mutating an existing
        // template goes through the per-field edits above). Wrap as a yaml
        // node via `doc.createNode` so subsequent edits in the same batch
        // (headers/footers/bleed) can descend into this newly-created
        // mapping — `setIn` rejects descent through a plain JS object.
        path = ["page-templates", edit.template];
        next = doc.createNode({
          size: formatPageSize(edit.value.size),
          margin: formatMargin(edit.value.margin)
        });
        break;
      case "token":
        path = ["design-tokens", edit.category, edit.name];
        next = edit.value;
        break;
    }

    const prev = doc.getIn(path);
    // Create-only: never clobber an existing template via the "add" edit
    // (mutating an existing template uses the per-field edits). This is the
    // safety counterpart to `default`'s immutability — make destructive
    // overwrites of a whole template impossible from the configurator.
    if (edit.kind === "page-template-add" && prev !== undefined) continue;
    if (mode === "merge" && yamlEqual(prev, next)) continue; // no-op
    doc.setIn(path, next);
    changed++;
  }
  return changed;
}

/**
 * Structural equality for the leaf values we write (string, number, the
 * literal 0, a {top,...} margin object, or a [w,h] size pair). yaml's
 * getIn returns plain JS for scalars and AST nodes for collections; we
 * compare via toJSON to normalize both sides.
 */
function yamlEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    v && typeof v === "object" && "toJSON" in v && typeof v.toJSON === "function"
      ? (v as { toJSON(): unknown }).toJSON()
      : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Serialize a Document back to a YAML string (comments preserved). */
export function serializeDocument(doc: Document): string {
  return String(doc);
}

export async function writeProjectDocument(
  projectDir: string,
  doc: Document
): Promise<void> {
  await writeFile(projectYamlPath(projectDir), serializeDocument(doc));
}

/**
 * A minimal, readable line diff between two YAML strings. Not a general
 * diff — it's the "show me exactly what changes before you write"
 * confirmation surface. Equal trailing/leading lines are elided; changed
 * regions print `- old` / `+ new` with a little context.
 *
 * Deliberately simple (longest-common-prefix/suffix, then a block in the
 * middle). project.yaml is small and the edits are localized, so this
 * reads better than a full Myers diff and carries no dependency.
 */
export function diffYaml(before: string, after: string): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");

  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;

  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) {
    suf++;
  }

  const aMid = a.slice(pre, a.length - suf);
  const bMid = b.slice(pre, b.length - suf);

  const ctx = 2;
  const out: string[] = [];
  const ctxStart = Math.max(0, pre - ctx);
  for (let i = ctxStart; i < pre; i++) out.push(`  ${a[i]}`);
  for (const line of aMid) out.push(`- ${line}`);
  for (const line of bMid) out.push(`+ ${line}`);
  const ctxEnd = Math.min(a.length, a.length - suf + ctx);
  for (let i = a.length - suf; i < ctxEnd; i++) out.push(`  ${a[i]}`);

  return out.join("\n");
}
