import { load as parseYaml } from "js-yaml";
import type { Range, Diagnostic } from "vscode-languageserver/node.js";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";

/**
 * Recovery-oriented split of a .tender file's source into its four sections.
 * Returns whatever can be identified plus diagnostics for the rest. Used by
 * the LSP's hover, definition, and document-symbols providers; never throws.
 *
 * The production parser (`parseTenderFile` in @tender/core) is the source of
 * truth for the file format — same column-0-anchored opener rules, same
 * frontmatter delimiters. The recovery version differs in three places:
 *   1. An unclosed frontmatter does not abort: the rest of the file is still
 *      identified as template/style/palette as best we can.
 *   2. An unclosed <style> or <palette> block reports a diagnostic but treats
 *      the rest of the file (until EOF or another opener) as that block's
 *      content, so an outline still shows up.
 *   3. Bad YAML in frontmatter or palette is reported but the section's
 *      content range is preserved.
 */

export interface TenderFileParseResult {
  /** Frontmatter section, parsed as YAML and shape-coerced. */
  frontmatter: Record<string, unknown>;
  /** Template section content range. May span the whole file when no other sections exist. */
  templateRange: Range;
  /** Style block content range, or undefined when there's no recognizable opener. */
  styleRange?: Range;
  /** Palette block content range. */
  paletteRange?: Range;
  /** The frontmatter section's content range (between the --- delimiters). */
  frontmatterRange?: Range;
  diagnostics: Diagnostic[];
}

export function parseTenderFileRecovery(source: string): TenderFileParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split("\n");
  let frontmatter: Record<string, unknown> = {};
  let frontmatterRange: Range | undefined;
  let styleRange: Range | undefined;
  let paletteRange: Range | undefined;
  let i = 0;

  // Frontmatter: `---` line at start, `---` line to close.
  if (lines[0]?.trim() === "---") {
    let close = -1;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j] === "---") { close = j; break; }
    }
    if (close === -1) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        message: "Frontmatter opened with --- but never closed.",
        range: lineRange(0, 0)
      });
      // Treat the whole file from line 1 onward as frontmatter "content"
      // for the purposes of the section range — providers can still show
      // an outline.
      frontmatterRange = lineRange(1, Math.max(1, lines.length));
      i = lines.length;
    } else {
      const fmText = lines.slice(1, close).join("\n");
      try {
        const parsed = parseYaml(fmText);
        if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
          frontmatter = parsed as Record<string, unknown>;
        } else if (parsed != null) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            message: "Frontmatter must be a YAML mapping.",
            range: lineRange(1, close)
          });
        }
      } catch (e) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          message: `Invalid frontmatter YAML: ${e instanceof Error ? e.message : String(e)}`,
          range: lineRange(1, close)
        });
      }
      frontmatterRange = lineRange(1, close);
      i = close + 1;
    }
  }

  // Template + named sections. Template runs from current position until the
  // first column-0 <style> or <palette> opener; named sections span from
  // their opener until the matching column-0 closer (or EOF, with a
  // diagnostic).
  const templateStart = i;
  let templateEnd = lines.length;
  let firstNamedAt = -1;

  while (i < lines.length) {
    const named = matchNamedOpener(lines[i] ?? "");
    if (named) {
      if (firstNamedAt === -1) {
        firstNamedAt = i;
        templateEnd = i;
      }
      const closerLine = `</${named}>`;
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] === closerLine) { close = j; break; }
      }
      const innerStart = i + 1;
      const innerEnd = close === -1 ? lines.length : close;
      if (close === -1) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          message: `<${named}> opened but no matching column-0 </${named}> found.`,
          range: lineRange(i, i + 1)
        });
      }
      const range = lineRange(innerStart, innerEnd);
      if (named === "style") {
        if (styleRange) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            message: "Duplicate <style> block.",
            range: lineRange(i, i + 1)
          });
        } else {
          styleRange = range;
        }
      } else {
        if (paletteRange) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            message: "Duplicate <palette> block.",
            range: lineRange(i, i + 1)
          });
        } else {
          paletteRange = range;
        }
      }
      i = close === -1 ? lines.length : close + 1;
      continue;
    }
    i++;
  }

  return {
    frontmatter,
    frontmatterRange,
    templateRange: lineRange(templateStart, templateEnd),
    styleRange,
    paletteRange,
    diagnostics
  };
}

/**
 * Recognize a column-0 opener for a known named section. The line must be
 * exactly `<style>` or `<palette>` — same restriction the production parser
 * uses; tag-attribute syntax on these openers is intentionally unsupported.
 */
function matchNamedOpener(line: string): "style" | "palette" | null {
  if (line === "<style>") return "style";
  if (line === "<palette>") return "palette";
  return null;
}

function lineRange(startLine: number, endLine: number): Range {
  return {
    start: { line: startLine, character: 0 },
    end: { line: endLine, character: 0 }
  };
}
