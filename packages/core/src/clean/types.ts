/**
 * Types for the tender clean module.
 *
 * Each normalizer reports its work as a CleanRuleChange; cleanText returns
 * a CleanResult with the cleaned output and a list of per-rule changes.
 * Rules that fired but found nothing to fix are omitted from the list.
 */

/** Codes for each rule, used in change summaries. Closed v1 union. */
export type CleanRuleCode =
  | "clean/bom"
  | "clean/line-endings"
  | "clean/zero-width"
  | "clean/soft-hyphens"
  | "clean/nbsp"
  | "clean/trailing-whitespace"
  | "clean/multiple-blank-lines"
  | "clean/typography";

export interface CleanRuleChange {
  code: CleanRuleCode;
  count: number;
  description: string;
}

export interface CleanResult {
  /** The cleaned source. Equal to the input if no rule fired. */
  output: string;
  /** Per-rule changes in run order. Rules with `count: 0` are omitted. */
  changes: CleanRuleChange[];
}

export interface CleanOptions {
  /** Run rule 8 (typography). Default: false. */
  typography?: boolean;
}

export function totalChanges(result: CleanResult): number {
  return result.changes.reduce((sum, c) => sum + c.count, 0);
}
