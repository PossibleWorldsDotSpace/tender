import { describe, it, expect } from "vitest";
import { rootToHost } from "./scope-css.ts";

describe("rootToHost", () => {
  it("extracts :root declarations and rewrites to :host", () => {
    const css = `:root { --a: red; --b: 12pt; } body { color: var(--a); }`;
    const result = rootToHost(css);
    expect(result).toContain(":host {");
    expect(result).toContain("--a: red");
    expect(result).toContain("--b: 12pt");
  });

  it("returns empty string when no :root rules present", () => {
    expect(rootToHost("body { color: red; }")).toBe("");
  });

  it("merges multiple :root blocks", () => {
    const css = `:root { --a: 1; } :root { --b: 2; }`;
    const result = rootToHost(css);
    expect(result).toContain("--a: 1");
    expect(result).toContain("--b: 2");
  });
});
