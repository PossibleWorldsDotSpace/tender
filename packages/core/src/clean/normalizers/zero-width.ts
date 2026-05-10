import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

const ZERO_WIDTH = new Set(["​", "‌", "‍", "⁠"]);

export interface ZeroWidthResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeZeroWidth(
  source: string,
  skip: SkipRegion[]
): ZeroWidthResult {
  let out = "";
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ZERO_WIDTH.has(ch) && !isInSkipRegion(i, skip)) {
      count++;
      continue;
    }
    out += ch;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/zero-width",
      count,
      description: `${count} zero-width character${count === 1 ? "" : "s"} removed`
    }
  };
}
