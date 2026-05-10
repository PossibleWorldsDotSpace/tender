import { describe, it, expect } from "vitest";
import { normalizeNbsp } from "./nbsp.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

// Use Unicode escapes for NBSP so editors don't silently turn them into
// regular spaces. The literal NBSP character (U+00A0) is visually
// indistinguishable from a regular space, which makes test fixtures
// fragile when copy-pasted or saved by autocorrecting editors.
const NBSP = "\u00A0";

describe("normalizeNbsp", () => {
  it("converts NBSP to a regular space", () => {
    const src = `45${NBSP}minutes`;
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe("45 minutes");
    expect(r.change?.count).toBe(1);
  });

  it("preserves NBSP inside a tag attribute value", () => {
    const src = `<row label="45${NBSP}minutes">body</row>`;
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("preserves NBSP inside a fenced code block", () => {
    const src = `\`\`\`\nfn(${NBSP}arg)\n\`\`\``;
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("preserves NBSP inside an inline code span", () => {
    const src = `use \`45${NBSP}minutes\` here`;
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("returns null change when there are no NBSPs to convert", () => {
    const src = "plain prose";
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeNbsp(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, `45${NBSP}minutes`);
    expectIdempotent(fn, "plain prose");
  });
});
