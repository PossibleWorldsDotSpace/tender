import { describe, it, expect } from "vitest";
import { normalizeZeroWidth } from "./zero-width.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeZeroWidth", () => {
  it("strips zero-width space (U+200B)", () => {
    const r = normalizeZeroWidth("a​b", computeSkipRegions("a​b"));
    expect(r.output).toBe("ab");
    expect(r.change?.count).toBe(1);
  });

  it("strips zero-width non-joiner (U+200C)", () => {
    const r = normalizeZeroWidth("a‌b", computeSkipRegions("a‌b"));
    expect(r.output).toBe("ab");
  });

  it("strips zero-width joiner (U+200D)", () => {
    const r = normalizeZeroWidth("a‍b", computeSkipRegions("a‍b"));
    expect(r.output).toBe("ab");
  });

  it("strips word joiner (U+2060)", () => {
    const r = normalizeZeroWidth("a⁠b", computeSkipRegions("a⁠b"));
    expect(r.output).toBe("ab");
  });

  it("strips multiple zero-width chars at once", () => {
    const src = "a​‌‍b";
    const r = normalizeZeroWidth(src, computeSkipRegions(src));
    expect(r.output).toBe("ab");
    expect(r.change?.count).toBe(3);
  });

  it("preserves zero-width chars inside a fenced code block", () => {
    const src = "before\n\n```\nzero​width\n```\n\nafter";
    const regions = computeSkipRegions(src);
    const r = normalizeZeroWidth(src, regions);
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("preserves zero-width chars inside an inline code span", () => {
    const src = "use `zero​width` here";
    const r = normalizeZeroWidth(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("returns null change when there's nothing to strip", () => {
    const r = normalizeZeroWidth("plain prose", computeSkipRegions("plain prose"));
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const src = "a​b‌c";
    const fn = (s: string) => normalizeZeroWidth(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, src);
    expectIdempotent(fn, "no changes");
  });
});
