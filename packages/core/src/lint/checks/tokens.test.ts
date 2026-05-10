import { describe, it, expect } from "vitest";
import { checkTokens } from "./tokens.js";

describe("checkTokens — value shape", () => {
  it("flags a non-CSS color string as warning", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { color: { ink: "#1a1a1a", accent: "mauveish" } }
    });
    const warns = findings.filter(f => f.severity === "warning");
    expect(warns.length).toBe(1);
    expect(warns[0]?.message).toContain("accent");
    expect(warns[0]?.code).toBe("tender/token-value-shape");
  });

  it("accepts hex, rgb(), hsl(), and CSS named colors", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: {
        color: {
          a: "#fff", b: "#ffffff", c: "#ffffff80",
          d: "rgb(0, 0, 0)", e: "rgba(0, 0, 0, 0.5)",
          f: "hsl(0, 0%, 0%)", g: "hsla(0, 0%, 0%, 0.5)",
          h: "rebeccapurple"
        }
      }
    });
    expect(findings).toEqual([]);
  });

  it("accepts CSS lengths including %, ch, ex, viewport units, and calc()/var()", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: {
        size: { a: "12pt", b: "8mm", c: "1em", d: "0" },
        space: { e: "50%", f: "3ch", g: "100vw", h: "calc(100% - 8mm)", i: "var(--gap)" }
      }
    });
    expect(findings).toEqual([]);
  });

  it("ignores unknown categories (no value-shape check)", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { vibe: { mood: "chill" } }
    });
    expect(findings).toEqual([]);
  });

  it("flags non-length size/space values", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { size: { h1: "huge" }, space: { gap: "wide" } }
    });
    expect(findings.length).toBe(2);
    expect(findings.every(f => f.code === "tender/token-value-shape")).toBe(true);
  });

  it("flags non-numeric leading", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { leading: { body: "1.6em" } }
    });
    expect(findings.length).toBe(1);
  });

  it("flags invalid font-weight", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { weight: { body: "kinda-bold" } }
    });
    expect(findings.length).toBe(1);
  });

  it("flags tokens declared but never referenced as info", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { color: { used: "#000", lonely: "#fff" } },
      consumedCss: "body { color: var(--color-used); }"
    });
    const unused = findings.filter(f => f.code === "tender/token-unused");
    expect(unused.length).toBe(1);
    expect(unused[0]?.severity).toBe("info");
    expect(unused[0]?.message).toContain("color.lonely");
  });

  it("recognises tokens used in component <style> blocks", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { color: { ink: "#000" } },
      consumedCss: ".callout { border-color: var(--color-ink); }"
    });
    expect(findings.filter(f => f.code === "tender/token-unused")).toEqual([]);
  });
});
