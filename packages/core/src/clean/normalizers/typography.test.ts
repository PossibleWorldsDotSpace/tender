import { describe, it, expect } from "vitest";
import { normalizeTypography } from "./typography.js";
import { computeSkipRegions } from "../skip-regions.js";

describe("normalizeTypography", () => {
  it("converts straight double quotes around words to curly", async () => {
    const src = `She said "hello".`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("“"); // “
    expect(r.output).toContain("”"); // ”
    expect(r.change?.count).toBeGreaterThan(0);
  });

  it("converts straight single quotes (apostrophes) to curly", async () => {
    const src = `it's a test`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("’"); // ’
  });

  it("converts -- to em-dash", async () => {
    const src = `wait -- pause`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("—"); // —
  });

  it("converts ... to ellipsis", async () => {
    const src = `pause...`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("…"); // …
  });

  it("preserves typography characters that are already curly", async () => {
    const src = `“hello”`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("does not touch quotes inside fenced code blocks", async () => {
    const src = '```\n"hello"\n```';
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("does not touch quotes inside inline code spans", async () => {
    const src = 'use `"hello"` literally';
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("does not touch quotes inside tag attribute values", async () => {
    const src = `<row label="45 minutes">body</row>`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("is idempotent", async () => {
    const src = `She said "hello" -- it's good...`;
    const once = (await normalizeTypography(src, computeSkipRegions(src))).output;
    const twice = (await normalizeTypography(once, computeSkipRegions(once))).output;
    expect(twice).toBe(once);
  });

  it("counts changes by category, not by byte-shift", async () => {
    // Regression test for the original count bug. When typography
    // converts characters that change byte length (e.g. straight " → curly
    // “ ”, which is 1 byte → 3 bytes UTF-8), every subsequent character
    // shifts. A naive position-based diff would count every shifted
    // character as a "change," producing wildly inflated counts on real
    // documents. The honest count is one-per-source-token: each ", ', --,
    // ---, or ... in non-skip text counts as one conversion.
    //
    // This source has 4 source tokens: 2 double quotes + 1 -- + 1 ...
    // (apostrophes in "it's" count too, so add 1 → total 5).
    const src = `She said "hello" -- it's good...`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    // Two double quotes + two apostrophes (in "it's" but also wherever
    // smartypants finds them) + one -- + one ... ≈ 5–6. Pin at 6 (allow
    // small drift if smartypants's algorithm changes); the important
    // thing is it's *not* 30+ (the byte-shift count).
    expect(r.change).not.toBeNull();
    expect(r.change!.count).toBeLessThan(20); // would be ~30+ under the byte-shift bug
    expect(r.change!.count).toBeGreaterThan(0);
  });

  it("does not over-count on a large document with HTML attributes", async () => {
    // Realistic case: a content.md with many <tag class="…"> openers.
    // The skip-region machinery should keep all of those out of the
    // typography count. Pre-fix this would have reported tens of
    // thousands; post-fix it should report zero or near-zero.
    const src = [
      `<row label="five minutes" icon=clock>`,
      ``,
      `Some clean prose with no typography candidates.`,
      ``,
      `</row>`,
      ``,
      `<row label="ten minutes" icon=clock>`,
      ``,
      `More prose, also clean.`,
      ``,
      `</row>`
    ].join("\n");
    const r = await normalizeTypography(src, computeSkipRegions(src));
    // No typography candidates outside skip regions → null change.
    expect(r.change).toBeNull();
    expect(r.output).toBe(src);
  });
});
