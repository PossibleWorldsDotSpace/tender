import { describe, it, expect } from "vitest";
import { normalizeLineEndings } from "./line-endings.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeLineEndings", () => {
  it("converts CRLF to LF", () => {
    const r = normalizeLineEndings("a\r\nb\r\nc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change?.count).toBe(2);
  });

  it("converts lone CR (legacy Mac) to LF", () => {
    const r = normalizeLineEndings("a\rb\rc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change?.count).toBe(2);
  });

  it("handles mixed CRLF and CR in one file", () => {
    const r = normalizeLineEndings("a\r\nb\rc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change?.count).toBe(2);
  });

  it("does nothing for LF-only input", () => {
    const r = normalizeLineEndings("a\nb\nc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeLineEndings(s).output;
    expectIdempotent(fn, "a\r\nb\rc");
    expectIdempotent(fn, "no changes");
  });
});
