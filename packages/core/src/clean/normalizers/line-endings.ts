import type { CleanRuleChange } from "../types.js";

export interface LineEndingsResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeLineEndings(source: string): LineEndingsResult {
  // Replace CRLF first to avoid double-counting (CR + LF would otherwise
  // be two changes for one logical line ending).
  let count = 0;
  let output = source.replace(/\r\n/g, () => { count++; return "\n"; });
  output = output.replace(/\r/g, () => { count++; return "\n"; });
  if (count === 0) return { output, change: null };
  return {
    output,
    change: {
      code: "clean/line-endings",
      count,
      description: `${count} line ending${count === 1 ? "" : "s"} normalized to LF`
    }
  };
}
