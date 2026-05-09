import { describe, it, expect } from "vitest";
import { preprocessPageBoundaries } from "./preprocess-page-boundaries.js";

describe("preprocessPageBoundaries — markers", () => {
  it("wraps lead content in an implicit <page>", () => {
    const r = preprocessPageBoundaries("# Hello\n\nA paragraph.\n");
    expect(r.source).toContain("<page>");
    expect(r.source).toContain("</page>");
    expect(r.source).toContain("# Hello");
    expect(r.source).toContain("A paragraph.");
    // One implicit page wrapping the whole content.
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
    expect((r.source.match(/<\/page>/g) ?? []).length).toBe(1);
  });

  it("rewrites a single marker into matched <page> tags", () => {
    const src = "Lead.\n\n=== page\n\nBody.\n";
    const r = preprocessPageBoundaries(src);
    expect(r.source).toContain("<page>");
    expect(r.source).toContain("</page>");
    // Two pages: lead + body.
    expect((r.source.match(/<page/g) ?? []).length).toBe(2);
    expect((r.source.match(/<\/page>/g) ?? []).length).toBe(2);
  });

  it("forwards attributes from `=== page{template=cover}`", () => {
    const r = preprocessPageBoundaries("=== page{template=cover}\n\nA\n");
    expect(r.source).toContain(`<page template="cover">`);
  });

  it("treats lone whitespace as no-lead (no implicit page emitted before first marker)", () => {
    const r = preprocessPageBoundaries("\n\n=== page\n\nBody.\n");
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
  });

  it("ignores `=== page` inside fenced code blocks", () => {
    const src = "Lead.\n\n```\n=== page\n```\n\nMore.\n";
    const r = preprocessPageBoundaries(src);
    // Should be one implicit page only — the marker inside ``` is literal.
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
    expect(r.source).toContain("=== page");
  });

  it("ignores `=== page` inside HTML comments", () => {
    const r = preprocessPageBoundaries("Lead.\n\n<!-- === page -->\n\nMore.\n");
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
  });

  it("does not match a setext H1 underline (`===` after a heading line)", () => {
    const src = "A heading\n===\n\nBody.\n";
    const r = preprocessPageBoundaries(src);
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
    expect(r.source).toContain("===");
  });

  it("errors on `=== page` inside an explicit <page> block", () => {
    const src = "<page>\n\n=== page\n\nx\n</page>\n";
    expect(() => preprocessPageBoundaries(src)).toThrow(/cannot appear inside/i);
  });

  it("emits a source map covering literal segments", () => {
    const src = "Para.\n\n=== page\n\nMore.\n";
    const r = preprocessPageBoundaries(src);
    // Each entry should round-trip a literal char.
    for (const e of r.sourceMap) {
      const slice = src.slice(e.originalStart, e.originalStart + e.length);
      expect(r.source.slice(e.rewrittenStart, e.rewrittenStart + e.length)).toBe(slice);
    }
  });

  it("does not match marker mid-line", () => {
    const r = preprocessPageBoundaries("Some text === page on a line.\n");
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
    expect(r.source).toContain("=== page on a line.");
  });

  it("returns input unchanged when there's no content (empty doc)", () => {
    const r = preprocessPageBoundaries("");
    expect(r.source).toBe("");
    expect((r.source.match(/<page/g) ?? []).length).toBe(0);
  });

  it("handles attribute with quoted value", () => {
    const r = preprocessPageBoundaries(`=== page{template="chapter-opener"}\n\nA\n`);
    expect(r.source).toContain(`<page template="chapter-opener">`);
  });
});
