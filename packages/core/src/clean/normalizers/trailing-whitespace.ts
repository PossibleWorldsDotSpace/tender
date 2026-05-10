import type { CleanRuleChange } from "../types.js";

export interface TrailingWhitespaceResult {
  output: string;
  change: CleanRuleChange | null;
}

/**
 * Trim trailing spaces/tabs from each line. Preserves a trailing
 * exactly-two-ASCII-spaces sequence on non-blank lines (Markdown's
 * hard-break syntax). Anything else — single trailing space, three or
 * more, or a mix of spaces and tabs — gets trimmed.
 *
 * No skip-region awareness: trailing whitespace inside fenced code or
 * tag attribute values can't exist by definition since those regions
 * don't end at a line break.
 */
export function normalizeTrailingWhitespace(source: string): TrailingWhitespaceResult {
  const lines = source.split("\n");
  let count = 0;
  const out = lines.map(line => {
    // Preserve `\S  ` (non-space + exactly two trailing spaces) → Markdown
    // hard break.
    if (/\S {2}$/.test(line)) return line;
    const trimmed = line.replace(/[ \t]+$/, "");
    if (trimmed !== line) count++;
    return trimmed;
  });
  if (count === 0) return { output: source, change: null };
  return {
    output: out.join("\n"),
    change: {
      code: "clean/trailing-whitespace",
      count,
      description: `${count} line${count === 1 ? "" : "s"} trimmed of trailing whitespace`
    }
  };
}
