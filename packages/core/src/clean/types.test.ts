import { describe, it, expect } from "vitest";
import type { CleanResult } from "./types.js";
import { totalChanges } from "./types.js";

describe("totalChanges", () => {
  it("sums change counts across rules", () => {
    const r: CleanResult = {
      output: "x",
      changes: [
        { code: "clean/bom", count: 1, description: "BOM removed" },
        { code: "clean/nbsp", count: 3, description: "3 NBSPs normalized" }
      ]
    };
    expect(totalChanges(r)).toBe(4);
  });

  it("returns zero for an empty changes array", () => {
    expect(totalChanges({ output: "", changes: [] })).toBe(0);
  });
});
