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
  let processedNonSkip = "";
  for (const seg of segments) {
    if (seg.skip) {
      out += seg.text;
    } else {
      originalNonSkip += seg.text;
      const processed = String(await processor.process(seg.text));
      processedNonSkip += processed;
      out += processed;
    }
  }

  if (out === source) {
    return { output: out, change: null };
  }

  // Approximate change count: number of differing chars between the
  // pre/post non-skip text. An integer is sufficient for the change summary.
  let count = 0;
  const minLen = Math.min(originalNonSkip.length, processedNonSkip.length);
  for (let i = 0; i < minLen; i++) {
    if (originalNonSkip[i] !== processedNonSkip[i]) count++;
  }
  count += Math.abs(originalNonSkip.length - processedNonSkip.length);

  return {
    output: out,
    change: {
      code: "clean/typography",
      count,
      description: `${count} typography character${count === 1 ? "" : "s"} normalized`
    }
  };
}
