import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

export interface MultipleBlankLinesResult {
  output: string;
  change: CleanRuleChange | null;
}

/**
 * Collapse runs of 3+ consecutive blank lines (i.e., 4+ consecutive
 * newlines) down to 2 blank lines (3 newlines). Skip regions are
 * preserved verbatim. Markdown only needs one blank between blocks;
 * two is a stylistic max for visual section breaks.
 */
export function normalizeMultipleBlankLines(
  source: string,
  skip: SkipRegion[]
): MultipleBlankLinesResult {
  let out = "";
  let i = 0;
  let count = 0;
  while (i < source.length) {
    if (isInSkipRegion(i, skip)) {
      const region = skip.find(r => r.start <= i && i < r.end)!;
      out += source.slice(region.start, region.end);
      i = region.end;
      continue;
    }
    if (source[i] === "\n") {
      let runEnd = i;
      while (runEnd < source.length && source[runEnd] === "\n") runEnd++;
      const runLen = runEnd - i;
      // 4+ newlines = 3+ blank lines. Collapse to 3 newlines (2 blank).
      if (runLen > 3) {
        out += "\n\n\n";
        count++;
      } else {
        out += source.slice(i, runEnd);
      }
      i = runEnd;
      continue;
    }
    out += source[i]!;
    i++;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/multiple-blank-lines",
      count,
      description: `${count} blank-line run${count === 1 ? "" : "s"} collapsed`
    }
  };
}
