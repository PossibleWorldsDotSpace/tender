import { describe, it, expect } from "vitest";
import { normalizeMultipleBlankLines } from "./multiple-blank-lines.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeMultipleBlankLines", () => {
  it("collapses 3+ blank lines to 2", () => {
    // "a\n\n\n\nb" = a + 4 newlines + b = "a", 3 blank lines, "b".
    // Collapse to 2 blank lines = "a\n\n\nb".
    const src = "a\n\n\n\nb";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe("a\n\n\nb");
    expect(r.change?.count).toBe(1);
  });

  it("preserves exactly 2 blank lines", () => {
    // "a\n\n\nb" = a + 3 newlines + b = "a", 2 blank lines, "b".
    const src = "a\n\n\nb";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("preserves 1 blank line", () => {
    const src = "a\n\nb";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("preserves blank-line runs inside fenced code", () => {
    const src = "before\n\n```\na\n\n\n\nb\n```\n\nafter";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("counts each collapsed run as one change", () => {
    const src = "a\n\n\n\nb\n\n\n\nc";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.change?.count).toBe(2);
  });

  it("collapses very long runs (10 newlines) to 3", () => {
    const src = "a\n\n\n\n\n\n\n\n\n\nb";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe("a\n\n\nb");
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeMultipleBlankLines(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, "a\n\n\n\nb");
    expectIdempotent(fn, "a\n\n\nb");
  });
});
