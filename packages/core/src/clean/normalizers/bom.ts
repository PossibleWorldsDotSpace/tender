import type { CleanRuleChange } from "../types.js";

export interface BomResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeBom(source: string): BomResult {
  if (!source.startsWith("\uFEFF")) {
    return { output: source, change: null };
  }
  return {
    output: source.slice(1),
    change: { code: "clean/bom", count: 1, description: "BOM removed" }
  };
}
