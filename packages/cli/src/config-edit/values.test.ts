import { describe, it, expect } from "vitest";
import {
  parseLength, formatLength, cycleUnit, isLengthUnit,
  parsePageSize, formatPageSize, isNamedPageSize,
  parseMargin, formatMargin,
  normalizeHex
} from "./values.js";

describe("length parse/format", () => {
  it("round-trips integer and decimal lengths", () => {
    for (const raw of ["18mm", "0pt", "3.5in", "210mm", "-2cm", "12px"]) {
      const p = parseLength(raw)!;
      expect(p).not.toBeNull();
      expect(formatLength(p)).toBe(raw);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(parseLength("  14mm \n")).toEqual({ value: 14, unit: "mm" });
  });

  it("rejects malformed or unitless values", () => {
    for (const bad of ["18", "18em", "mm", "", "1 8mm", "18 mm", "abc"]) {
      expect(parseLength(bad)).toBeNull();
    }
  });

  it("isLengthUnit guards the unit set", () => {
    expect(isLengthUnit("mm")).toBe(true);
    expect(isLengthUnit("em")).toBe(false);
  });

  it("cycleUnit wraps both directions", () => {
    expect(cycleUnit("mm")).toBe("cm");
    expect(cycleUnit("px")).toBe("mm"); // wrap forward
    expect(cycleUnit("mm", -1)).toBe("px"); // wrap backward
  });
});

describe("page size parse/format", () => {
  it("recognizes named sizes", () => {
    expect(isNamedPageSize("A4")).toBe(true);
    expect(isNamedPageSize("A7")).toBe(false);
    expect(parsePageSize("A5")).toEqual({ kind: "named", name: "A5" });
    expect(formatPageSize({ kind: "named", name: "Letter" })).toBe("Letter");
  });

  it("parses an explicit [w, h] pair as custom", () => {
    expect(parsePageSize(["210mm", "297mm"])).toEqual({
      kind: "custom", width: "210mm", height: "297mm"
    });
    expect(formatPageSize({ kind: "custom", width: "8in", height: "10in" }))
      .toEqual(["8in", "10in"]);
  });

  it("treats an unknown string as a custom square (lenient fallback)", () => {
    expect(parsePageSize("B5")).toEqual({ kind: "custom", width: "B5", height: "B5" });
  });
});

describe("margin parse/format", () => {
  it("handles the literal 0", () => {
    expect(parseMargin(0)).toEqual({ kind: "zero" });
    expect(formatMargin({ kind: "zero" })).toBe(0);
  });

  it("round-trips a box and maps left/right → inner/outer", () => {
    const parsed = parseMargin({ top: "18mm", bottom: "20mm", left: "18mm", right: "14mm" });
    expect(parsed).toEqual({
      kind: "box", top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm"
    });
    expect(formatMargin(parsed!)).toEqual({
      top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm"
    });
  });

  it("inner/outer win over left/right when both present", () => {
    const parsed = parseMargin({ inner: "1mm", left: "9mm", outer: "2mm", right: "9mm" });
    expect(parsed).toMatchObject({ inner: "1mm", outer: "2mm" });
  });

  it("omits absent box keys on format", () => {
    expect(formatMargin({ kind: "box", top: "10mm" })).toEqual({ top: "10mm" });
  });

  it("returns null for non-margin shapes", () => {
    expect(parseMargin("18mm")).toBeNull();
    expect(parseMargin(42)).toBeNull();
    expect(parseMargin(["a", "b"])).toBeNull();
  });
});

describe("normalizeHex", () => {
  it("normalizes 3- and 6-digit, optional #, to #rrggbb lowercase", () => {
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex("#1A2B3C")).toBe("#1a2b3c");
    expect(normalizeHex("  #FFE600 ")).toBe("#ffe600");
  });

  it("returns null for non-hex token values", () => {
    for (const v of ["red", "rgb(0,0,0)", "#12", "#12345", "#1234567", ""]) {
      expect(normalizeHex(v)).toBeNull();
    }
  });
});
