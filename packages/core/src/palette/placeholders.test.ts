import { describe, it, expect } from "vitest";
import { placeholderBody, placeholderAttr } from "./placeholders.js";

describe("placeholderBody", () => {
  it("returns a non-empty English string", () => {
    const s = placeholderBody();
    expect(s.length).toBeGreaterThan(20);
    expect(s).toMatch(/[a-z]/i);
  });

  it("returns deterministic output for a given seed", () => {
    expect(placeholderBody(0)).toBe(placeholderBody(0));
    expect(placeholderBody(0)).not.toBe(placeholderBody(1));
  });
});

describe("placeholderAttr", () => {
  it("returns the first declared enum value when known", () => {
    expect(placeholderAttr("variant", ["warning", "info"])).toBe("warning");
  });

  it("returns 'sample' for an unconstrained attr", () => {
    expect(placeholderAttr("speaker")).toBe("sample");
  });
});
