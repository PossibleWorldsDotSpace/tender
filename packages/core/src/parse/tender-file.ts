import { load as parseYaml } from "js-yaml";
import { Palette } from "../config/schema.js";
import type { z } from "zod";

/**
 * Single-file Tender component format.
 *
 *   ---
 *   <frontmatter as YAML>
 *   ---
 *
 *   <template HTML with Handlebars>
 *
 *   <style>
 *   <CSS>
 *   </style>
 *
 *   <palette>
 *   <palette as YAML>
 *   </palette>
 *
 * Section split is line-oriented and column-0-anchored. We do NOT use an HTML
 * parser here: the template body contains Handlebars syntax that an HTML
 * parser would mishandle, and the column-0 rule is sufficient to disambiguate
 * a `<style>` opener tag from a `<style>` substring inside a Handlebars
 * conditional or CSS string value.
 */

export interface TenderFrontmatter {
  /** Param names accepted as attributes on the component invocation. */
  params?: string[];
  /** Named slots; content is split with `@@ slotname` markers (or legacy `--- slotname ---`). */
  slots?: string[];
  /** True when the component cannot appear at block level. */
  inline?: boolean;
  /** Reserved for component composition (item 10b). */
  extends?: string;
  /** Simple-component shorthand: HTML tag to wrap body in (e.g. "aside", "span"). */
  tag?: string;
  /** Simple-component shorthand: CSS class added to the wrapper. */
  class?: string;
  /** Simple-component shorthand: whitelist of attribute names; each becomes data-NAME. */
  attrs?: string[];
}

export type PaletteBlock = z.infer<typeof Palette>;

export interface SectionRange {
  /** 1-indexed line number where the section's content starts. */
  start: number;
  /** 1-indexed line number where the section's content ends (inclusive). */
  end: number;
}

export interface TenderFile {
  /** Component name; the caller derives this from the filename and passes it through. */
  name: string;
  /** Absolute path; carried through for error messages and LSP definition jumps. */
  path: string;
  /** Parsed frontmatter, or {} if none. */
  frontmatter: TenderFrontmatter;
  /** Raw template HTML with Handlebars syntax preserved. */
  template: string;
  /** Inner content of <style>…</style>, or undefined. */
  style?: string;
  /** Inner content of <palette>…</palette>, parsed as YAML and Zod-validated, or undefined. */
  palette?: PaletteBlock;
  /** 1-indexed line offsets so the LSP can map errors back to source. */
  offsets: {
    frontmatter?: SectionRange;
    template: SectionRange;
    style?: SectionRange;
    palette?: SectionRange;
  };
}

/**
 * Parse a `.tender` file's source text into structured form. Pure: takes a
 * source string, returns the parsed shape. Throws on malformed input with a
 * line-number-prefixed message.
 *
 * `name` is derived by the caller from the filename; `path` is the absolute
 * path used for error context. Neither is read from the source.
 */
export function parseTenderFile(source: string, opts: { name: string; path: string }): TenderFile {
  const lines = source.split("\n");
  let i = 0;

  const offsets: TenderFile["offsets"] = { template: { start: 1, end: 1 } };
  let frontmatter: TenderFrontmatter = {};
  let templateLines: string[] = [];
  let style: string | undefined;
  let palette: PaletteBlock | undefined;

  // ── Frontmatter (optional). Must be the first non-empty line.
  if (lines[0]?.trim() === "---") {
    const fmStart = 2; // 1-indexed; first line of frontmatter is line 2
    let fmClose = -1;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j] === "---") { fmClose = j; break; }
    }
    if (fmClose === -1) {
      throw new Error(`${opts.path}:1: frontmatter opened with --- but never closed`);
    }
    const fmText = lines.slice(1, fmClose).join("\n");
    try {
      const parsed = parseYaml(fmText);
      // Empty frontmatter (e.g. `---\n---`) yields null; treat as empty object.
      frontmatter = parsed == null ? {} : (parsed as TenderFrontmatter);
      if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
        throw new Error("frontmatter must be a YAML mapping");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${opts.path}:${fmStart}: invalid frontmatter YAML: ${msg}`);
    }
    // Content range is inclusive of the last content line. fmClose is the
    // 0-indexed line of the closing `---`; the last content line above it
    // is fmClose - 1 (0-indexed) = fmClose (1-indexed).
    offsets.frontmatter = { start: fmStart, end: fmClose };
    i = fmClose + 1;
  }

  // ── Template + named blocks (style, palette).
  // The template runs from after the frontmatter until the first column-0
  // <style> or <palette> opener. Named blocks may appear in any order; both
  // are optional. Anything after a closer falls back to template again.
  const templateStart = i + 1; // 1-indexed
  let templateEnd = lines.length; // updated as we discover named blocks

  while (i < lines.length) {
    const line = lines[i]!;
    const named = matchNamedOpener(line);
    if (named) {
      // Capture template lines collected so far (might be empty).
      if (templateLines.length === 0) {
        // First named block: template runs from `templateStart` to (i) — we
        // record the template range as ending on the line BEFORE this opener.
        templateEnd = i; // 0-indexed → represents 1-indexed line i (the line above the opener)
        templateLines = lines.slice(templateStart - 1, i);
      }
      // Find the matching column-0 closer.
      const closerLine = `</${named.name}>`;
      let closerIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] === closerLine) { closerIdx = j; break; }
      }
      if (closerIdx === -1) {
        throw new Error(`${opts.path}:${i + 1}: <${named.name}> opened but no matching column-0 </${named.name}> found`);
      }
      const innerStart = i + 2; // 1-indexed line after opener
      const innerEnd = closerIdx; // 1-indexed (closer is at 0-indexed closerIdx → 1-indexed closerIdx+1; inner ends one above)
      const innerText = lines.slice(i + 1, closerIdx).join("\n");
      if (named.name === "style") {
        if (style !== undefined) {
          throw new Error(`${opts.path}:${i + 1}: duplicate <style> block`);
        }
        style = innerText;
        offsets.style = { start: innerStart, end: innerEnd };
      } else {
        // palette
        if (palette !== undefined) {
          throw new Error(`${opts.path}:${i + 1}: duplicate <palette> block`);
        }
        let parsedYaml: unknown;
        try {
          parsedYaml = parseYaml(innerText) ?? {};
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`${opts.path}:${innerStart}: invalid palette YAML: ${msg}`);
        }
        const result = Palette.safeParse(parsedYaml);
        if (!result.success) {
          throw new Error(`${opts.path}:${innerStart}: palette failed schema validation: ${result.error.message}`);
        }
        palette = result.data;
        offsets.palette = { start: innerStart, end: innerEnd };
      }
      i = closerIdx + 1;
      continue;
    }
    i++;
  }

  // No named blocks were found; the template runs to the end of the file.
  if (templateLines.length === 0) {
    templateLines = lines.slice(templateStart - 1);
    templateEnd = lines.length;
  }

  // Strip leading/trailing blank lines from the captured template, but keep
  // the offsets pointing at the true file lines (not the trimmed range).
  const template = stripSurroundingBlankLines(templateLines).join("\n");
  offsets.template = { start: templateStart, end: templateEnd };

  return {
    name: opts.name,
    path: opts.path,
    frontmatter,
    template,
    style,
    palette,
    offsets
  };
}

/**
 * Recognize a column-0 opener for a known named section (`<style>` or
 * `<palette>`). The opener line must be exactly `<name>` with no attributes
 * — `<style scoped>` or `<style>foo</style>` on one line are intentionally
 * not supported. This keeps the parser deterministic; users can author both
 * forms by separating them onto multiple lines.
 */
function matchNamedOpener(line: string): { name: "style" | "palette" } | null {
  if (line === "<style>") return { name: "style" };
  if (line === "<palette>") return { name: "palette" };
  return null;
}

function stripSurroundingBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}
