import { describe, it, expect } from "vitest";
import { normalizeTypography } from "./typography.js";
import { computeSkipRegions } from "../skip-regions.js";

describe("normalizeTypography", () => {
  it("converts straight double quotes around words to curly", async () => {
    const src = `She said "hello".`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("“"); // “
    expect(r.output).toContain("”"); // ”
    expect(r.change?.count).toBeGreaterThan(0);
  });

  it("converts straight single quotes (apostrophes) to curly", async () => {
    const src = `it's a test`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("’"); // ’
  });

  it("converts -- to em-dash", async () => {
    const src = `wait -- pause`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("—"); // —
  });

  it("converts ... to ellipsis", async () => {
    const src = `pause...`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("…"); // …
  });

  it("preserves typography characters that are already curly", async () => {
    const src = `“hello”`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("does not touch quotes inside fenced code blocks", async () => {
    const src = '```\n"hello"\n```';
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("does not touch quotes inside inline code spans", async () => {
    const src = 'use `"hello"` literally';
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("does not touch quotes inside tag attribute values", async () => {
    const src = `<row label="45 minutes">body</row>`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("is idempotent", async () => {
    const src = `She said "hello" -- it's good...`;
    const once = (await normalizeTypography(src, computeSkipRegions(src))).output;
    const twice = (await normalizeTypography(once, computeSkipRegions(once))).output;
    expect(twice).toBe(once);
  });
});
