import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

const SOFT_HYPHEN = "­";

export interface SoftHyphensResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeSoftHyphens(
  source: string,
  skip: SkipRegion[]
): SoftHyphensResult {
  let out = "";
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === SOFT_HYPHEN && !isInSkipRegion(i, skip)) {
      count++;
      continue;
    }
    out += ch;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/soft-hyphens",
      count,
      description: `${count} soft hyphen${count === 1 ? "" : "s"} removed`
    }
  };
}
