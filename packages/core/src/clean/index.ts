import type { CleanOptions, CleanResult, CleanRuleChange } from "./types.js";
import { computeSkipRegions } from "./skip-regions.js";
import { normalizeBom } from "./normalizers/bom.js";
import { normalizeLineEndings } from "./normalizers/line-endings.js";
import { normalizeZeroWidth } from "./normalizers/zero-width.js";
import { normalizeSoftHyphens } from "./normalizers/soft-hyphens.js";
import { normalizeNbsp } from "./normalizers/nbsp.js";
import { normalizeTrailingWhitespace } from "./normalizers/trailing-whitespace.js";
import { normalizeMultipleBlankLines } from "./normalizers/multiple-blank-lines.js";
import { normalizeTypography } from "./normalizers/typography.js";

export type { CleanOptions, CleanResult, CleanRuleChange, CleanRuleCode } from "./types.js";
export { totalChanges } from "./types.js";

/**
 * Apply the v1 clean pipeline: 7 default-on character/whitespace rules
 * plus one opt-in typography rule. Each rule's contribution is appended
 * to the `changes` list (rules with zero changes are omitted).
 *
 * Skip regions (fenced code, inline code, tag openers, column-0 markers)
 * are recomputed after each rule whose changes shifted offsets — in
 * practice that's almost every rule, so we just recompute every time.
 * Cost is O(n) per pass and n is small for content.md.
 */
export async function cleanText(
  source: string,
  opts: CleanOptions = {}
): Promise<CleanResult> {
  const changes: CleanRuleChange[] = [];
  let s = source;

  // 1. BOM.
  const bom = normalizeBom(s);
  if (bom.change) changes.push(bom.change);
  s = bom.output;

  // 2. Line endings.
  const le = normalizeLineEndings(s);
  if (le.change) changes.push(le.change);
  s = le.output;

  let skip = computeSkipRegions(s);

  // 3. Zero-width.
  const zw = normalizeZeroWidth(s, skip);
  if (zw.change) changes.push(zw.change);
  s = zw.output;
  if (zw.change) skip = computeSkipRegions(s);

  // 4. Soft hyphens.
  const sh = normalizeSoftHyphens(s, skip);
  if (sh.change) changes.push(sh.change);
  s = sh.output;
  if (sh.change) skip = computeSkipRegions(s);

  // 5. NBSP.
  const nb = normalizeNbsp(s, skip);
  if (nb.change) changes.push(nb.change);
  s = nb.output;
  if (nb.change) skip = computeSkipRegions(s);

  // 6. Trailing whitespace (line-by-line; no skip awareness needed).
  const tw = normalizeTrailingWhitespace(s);
  if (tw.change) changes.push(tw.change);
  s = tw.output;
  skip = computeSkipRegions(s);

  // 7. Multiple blank lines.
  const mbl = normalizeMultipleBlankLines(s, skip);
  if (mbl.change) changes.push(mbl.change);
  s = mbl.output;

  // 8. Typography (opt-in).
  if (opts.typography) {
    skip = computeSkipRegions(s);
    const ty = await normalizeTypography(s, skip);
    if (ty.change) changes.push(ty.change);
    s = ty.output;
  }

  return { output: s, changes };
}
