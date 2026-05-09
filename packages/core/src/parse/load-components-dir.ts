import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Component } from "../config/schema.js";
import { parseTenderFile } from "./tender-file.js";
import type { TenderFile } from "./tender-file.js";
import type { z } from "zod";

export type ComponentDef = z.infer<typeof Component>;

export interface RegistryEntry {
  def: ComponentDef;
  source: { path: string };
}

/**
 * Diagnostics produced during registry loading. Currently a placeholder shape
 * — the only producer (PR 1.3) emits deprecation warnings for legacy YAML
 * `templates:` and `attrs:` keys when those land alongside a `components/`
 * directory. PR 1.2 produces no diagnostics; the array is always empty.
 */
export interface Diagnostic {
  severity: "warning" | "error";
  message: string;
  source?: { path: string };
}

export interface ComponentRegistry {
  /** Components keyed by name (filename without `.tender` extension). */
  byName: Map<string, RegistryEntry>;
  /**
   * Concatenated `<style>` blocks from every component's source, joined in
   * alphabetical-by-name order with a newline between them. Empty string when
   * no component declared a style block.
   */
  combinedCss: string;
  diagnostics: Diagnostic[];
}

/**
 * Discover and load every `.tender` component under `{projectDir}/components/`.
 * Returns an empty registry (no throw) when the directory is missing — the
 * legacy YAML pathway in `loadProjectConfig` is the fallback.
 *
 * Within `components/`, two files producing the same component name (after
 * stripping the `.tender` extension) is a hard error: the registry has no
 * scoping rules and an author needs to know they have a collision.
 */
export async function loadComponentsDir(projectDir: string): Promise<ComponentRegistry> {
  const dir = join(projectDir, "components");
  const tenderFiles = await collectTenderFiles(dir);

  // Sort by component name so the combined CSS order is deterministic.
  tenderFiles.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const byName = new Map<string, RegistryEntry>();
  const cssParts: string[] = [];

  for (const tf of tenderFiles) {
    const existing = byName.get(tf.name);
    if (existing) {
      throw new Error(
        `Duplicate component name "${tf.name}" in:\n  ${existing.source.path}\n  ${tf.path}`
      );
    }
    const def = tenderFileToComponent(tf);
    byName.set(tf.name, { def, source: { path: tf.path } });
    if (tf.style) cssParts.push(tf.style);
  }

  return {
    byName,
    combinedCss: cssParts.join("\n"),
    diagnostics: []
  };
}

/**
 * Walk the components directory recursively, parsing every `.tender` file
 * into its TenderFile shape. Returns [] when the directory does not exist;
 * any other I/O error propagates so build failures are surfaced.
 */
async function collectTenderFiles(dir: string): Promise<TenderFile[]> {
  let exists = true;
  try {
    const st = await stat(dir);
    if (!st.isDirectory()) exists = false;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw err;
  }
  if (!exists) return [];

  const out: TenderFile[] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".tender")) continue;
    // Node typings on `Dirent` from a recursive readdir include `parentPath`
    // (Node 20.12+) or `path` (older). Use either; fall back to the dir.
    const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath
      ?? (entry as unknown as { path?: string }).path
      ?? dir;
    const filePath = join(parent, entry.name);
    const source = await readFile(filePath, "utf8");
    const name = entry.name.slice(0, -".tender".length);
    out.push(parseTenderFile(source, { name, path: filePath }));
  }
  return out;
}

/**
 * Convert a parsed TenderFile into a validated Component. The parser's
 * frontmatter is a structural view; this is where we Zod-validate against the
 * config schema and surface field-level errors with file context.
 *
 * Mapping:
 * - `frontmatter.attrs` (legacy) → `params` if `params` not already set.
 * - Empty `template` is dropped (wrapper component).
 * - Non-empty `template` is included verbatim (block-template component).
 */
function tenderFileToComponent(tf: TenderFile): ComponentDef {
  const fm = tf.frontmatter;
  const params = fm.params ?? fm.attrs;
  const candidate: Record<string, unknown> = {};
  if (fm.tag !== undefined) candidate.tag = fm.tag;
  if (fm.class !== undefined) candidate.class = fm.class;
  if (params !== undefined) candidate.params = params;
  if (fm.slots !== undefined) candidate.slots = fm.slots;
  if (fm.inline !== undefined) candidate.inline = fm.inline;
  if (tf.template.length > 0) candidate.template = tf.template;
  if (tf.palette !== undefined) candidate.palette = tf.palette;

  const result = Component.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `${tf.path}: invalid component frontmatter: ${result.error.issues.map(i => i.message).join("; ")}`
    );
  }
  return result.data;
}
