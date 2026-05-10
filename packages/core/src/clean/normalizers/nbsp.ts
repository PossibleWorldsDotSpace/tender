import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

// Use a Unicode escape so the source is unambiguous regardless of editor.
const NBSP = "\u00A0";

export interface NbspResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeNbsp(
  source: string,
  skip: SkipRegion[]
): NbspResult {
  let out = "";
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === NBSP && !isInSkipRegion(i, skip)) {
      out += " ";
      count++;
      continue;
    }
    out += ch;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/nbsp",
      count,
      description: `${count} NBSP${count === 1 ? "" : "s"} normalized to space`
    }
  };
}
