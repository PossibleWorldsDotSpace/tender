import { describe, it, expect } from "vitest";
import { composeSourceMaps } from "./compose-source-maps.js";
import type { SourceMapEntry } from "./compose-source-maps.js";

describe("composeSourceMaps", () => {
  it("returns the input unchanged when there's a single map", () => {
    const map: SourceMapEntry[] = [{ rewrittenStart: 0, originalStart: 0, length: 5 }];
    expect(composeSourceMaps([map])).toEqual(map);
  });

  it("returns empty array for empty input", () => {
    expect(composeSourceMaps([])).toEqual([]);
  });

  it("folds two transforms back to original-source positions", () => {
    // Stage 1: maps "abc" (3 chars at offset 0) to position 0 in stage-1
    //          output (identity).
    const m1: SourceMapEntry[] = [{ rewrittenStart: 0, originalStart: 0, length: 3 }];
    // Stage 2: maps "abc" (3 chars) from position 0 in stage-1 input to
    //          position 5 in final output.
    const m2: SourceMapEntry[] = [{ rewrittenStart: 5, originalStart: 0, length: 3 }];
    const composed = composeSourceMaps([m1, m2]);
    // Composed should map output position 5 back to original position 0.
    expect(composed).toHaveLength(1);
    expect(composed[0]).toEqual({ rewrittenStart: 5, originalStart: 0, length: 3 });
  });

  it("folds three transforms", () => {
    // Identity through three layers, just shifted by each.
    // Layer 1: original 0..5 → stage-1 output 10..15
    // Layer 2: stage-1 output 10..15 → stage-2 output 20..25
    // Layer 3: stage-2 output 20..25 → stage-3 output 30..35
    const m1: SourceMapEntry[] = [{ rewrittenStart: 10, originalStart: 0, length: 5 }];
    const m2: SourceMapEntry[] = [{ rewrittenStart: 20, originalStart: 10, length: 5 }];
    const m3: SourceMapEntry[] = [{ rewrittenStart: 30, originalStart: 20, length: 5 }];
    const composed = composeSourceMaps([m1, m2, m3]);
    expect(composed).toHaveLength(1);
    expect(composed[0]).toEqual({ rewrittenStart: 30, originalStart: 0, length: 5 });
  });

  it("drops segments not traceable through the chain", () => {
    // Stage 2 references a stage-1 region not present in m1.
    const m1: SourceMapEntry[] = [{ rewrittenStart: 0, originalStart: 0, length: 5 }];
    const m2: SourceMapEntry[] = [
      { rewrittenStart: 0, originalStart: 0, length: 5 }, // traceable
      { rewrittenStart: 10, originalStart: 100, length: 3 } // NOT in m1
    ];
    const composed = composeSourceMaps([m1, m2]);
    expect(composed).toHaveLength(1);
    expect(composed[0]?.rewrittenStart).toBe(0);
  });

  it("preserves multiple distinct ranges in a chain", () => {
    const m1: SourceMapEntry[] = [
      { rewrittenStart: 0, originalStart: 0, length: 3 },
      { rewrittenStart: 5, originalStart: 10, length: 2 }
    ];
    const m2: SourceMapEntry[] = [
      { rewrittenStart: 0, originalStart: 0, length: 3 },
      { rewrittenStart: 5, originalStart: 5, length: 2 }
    ];
    const composed = composeSourceMaps([m1, m2]);
    expect(composed).toHaveLength(2);
    expect(composed.find(e => e.rewrittenStart === 0)?.originalStart).toBe(0);
    expect(composed.find(e => e.rewrittenStart === 5)?.originalStart).toBe(10);
  });
});
