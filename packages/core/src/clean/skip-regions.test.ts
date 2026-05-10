import { describe, it, expect } from "vitest";
import { computeSkipRegions, isInSkipRegion } from "./skip-regions.js";

describe("computeSkipRegions", () => {
  it("identifies fenced code blocks at line start", () => {
    const src = "Lead.\n\n```\ncode here\n```\n\nMore.";
    const regions = computeSkipRegions(src);
    // The fenced block from offset of the first ``` through the line
    // containing the closing ```.
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions.some(r => src.slice(r.start, r.end).includes("code here"))).toBe(true);
  });

  it("identifies ~~~ fenced blocks", () => {
    const src = "~~~\nx\n~~~\n";
    const regions = computeSkipRegions(src);
    expect(regions.length).toBeGreaterThanOrEqual(1);
  });

  it("identifies inline code spans", () => {
    const src = "Use `<row>` here.";
    const regions = computeSkipRegions(src);
    expect(regions.some(r => src.slice(r.start, r.end) === "`<row>`")).toBe(true);
  });

  it("identifies HTML comments", () => {
    const src = "Before <!-- comment --> after.";
    const regions = computeSkipRegions(src);
    expect(regions.some(r => src.slice(r.start, r.end) === "<!-- comment -->")).toBe(true);
  });

  it("identifies tag openers (preserving attribute values)", () => {
    const src = `<row label="45 minutes">body</row>`;
    const regions = computeSkipRegions(src);
    expect(regions.some(r => src.slice(r.start, r.end) === `<row label="45 minutes">`)).toBe(true);
    expect(regions.some(r => src.slice(r.start, r.end) === `</row>`)).toBe(true);
  });

  it("identifies column-0 page markers", () => {
    const src = "Lead.\n\n=== page\n\nBody.";
    const regions = computeSkipRegions(src);
    expect(regions.some(r => src.slice(r.start, r.end).includes("=== page"))).toBe(true);
  });

  it("identifies column-0 @@ slot markers", () => {
    const src = "<ad-lib>\n@@ suggested\nbody\n</ad-lib>";
    const regions = computeSkipRegions(src);
    expect(regions.some(r => src.slice(r.start, r.end).includes("@@ suggested"))).toBe(true);
  });

  it("returns empty for prose with no skip regions", () => {
    const regions = computeSkipRegions("Just plain prose here.");
    expect(regions).toEqual([]);
  });
});

describe("isInSkipRegion", () => {
  const regions = [
    { start: 0, end: 5 },
    { start: 10, end: 20 }
  ];

  it("returns true for offsets inside a region", () => {
    expect(isInSkipRegion(0, regions)).toBe(true);
    expect(isInSkipRegion(4, regions)).toBe(true);
    expect(isInSkipRegion(15, regions)).toBe(true);
  });

  it("returns false for offsets outside any region", () => {
    expect(isInSkipRegion(5, regions)).toBe(false);
    expect(isInSkipRegion(7, regions)).toBe(false);
    expect(isInSkipRegion(100, regions)).toBe(false);
  });
});
