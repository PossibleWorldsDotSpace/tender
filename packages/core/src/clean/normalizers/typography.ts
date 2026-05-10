import { unified } from "unified";
import retextEnglish from "retext-english";
import retextSmartypants from "retext-smartypants";
import retextStringify from "retext-stringify";
import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";

export interface TypographyResult {
  output: string;
  change: CleanRuleChange | null;
}

/**
 * Apply smart-typography conversions (curly quotes, em/en-dashes, ellipsis)
 * to the parts of the source not in a skip region. Each non-skip segment is
 * processed independently; skip regions splice back verbatim.
 *
 * Powered by retext-smartypants. Idempotent by spec — running twice on the
 * same input produces the same output.
 */
export async function normalizeTypography(
  source: string,
  skip: SkipRegion[]
): Promise<TypographyResult> {
  // Build alternating segments: non-skip text and skip-region text.
  const sortedSkip = [...skip].sort((a, b) => a.start - b.start);
  const segments: { text: string; skip: boolean }[] = [];
  let cursor = 0;
  for (const r of sortedSkip) {
    if (r.start > cursor) {
      segments.push({ text: source.slice(cursor, r.start), skip: false });
    }
    segments.push({ text: source.slice(r.start, r.end), skip: true });
    cursor = r.end;
  }
  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), skip: false });
  }

  const processor = unified()
    .use(retextEnglish)
    .use(retextSmartypants)
    .use(retextStringify);

  let out = "";
  let originalNonSkip = "";
  for (const seg of segments) {
    if (seg.skip) {
      out += seg.text;
    } else {
      originalNonSkip += seg.text;
      const processed = String(await processor.process(seg.text));
      out += processed;
    }
  }

  if (out === source) {
    return { output: out, change: null };
  }

  // Count by category: each typography-source token in the non-skip input
  // that retext-smartypants converts. Position-based diffing would inflate
  // the count enormously because curly quotes and em-dashes change byte
  // length, shifting all subsequent characters.
  const count = countTypographyChanges(originalNonSkip);

  return {
    output: out,
    change: {
      code: "clean/typography",
      count,
      description: `${count} typography conversion${count === 1 ? "" : "s"}`
    }
  };
}

/**
 * Count tokens in the input that retext-smartypants converts:
 *   - Straight double quotes (")
 *   - Straight single quotes / apostrophes (')
 *   - Triple-hyphen (---) and double-hyphen (--)
 *   - Triple-dot (...)
 *
 * Approximate but more honest than a position-based byte diff.
 */
function countTypographyChanges(text: string): number {
  let count = 0;
  count += (text.match(/"/g) ?? []).length;
  count += (text.match(/'/g) ?? []).length;
  // ---. Match triple-hyphen first; remaining double-hyphens are counted next.
  count += (text.match(/---/g) ?? []).length;
  // -- not part of a triple-hyphen run.
  count += (text.match(/(?<!-)--(?!-)/g) ?? []).length;
  count += (text.match(/\.\.\./g) ?? []).length;
  return count;
}
