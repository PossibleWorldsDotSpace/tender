import { describe, it, expect } from "vitest";
import { normalizeSoftHyphens } from "./soft-hyphens.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeSoftHyphens", () => {
  it("strips soft hyphens", () => {
    const src = "im­por­tant";
    const r = normalizeSoftHyphens(src, computeSkipRegions(src));
    expect(r.output).toBe("important");
    expect(r.change?.count).toBe(2);
  });

  it("preserves soft hyphens inside a fenced code block", () => {
    const src = "before\n\n```\nim­portant\n```\n\nafter";
    const r = normalizeSoftHyphens(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("returns null change when there's nothing to strip", () => {
    const r = normalizeSoftHyphens("plain prose", computeSkipRegions("plain prose"));
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeSoftHyphens(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, "im­por­tant");
    expectIdempotent(fn, "no changes");
  });
});
