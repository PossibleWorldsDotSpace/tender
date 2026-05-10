import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";
import { listTokens, formatTokensList } from "./tokens.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../core/test/fixtures");

describe("yaml round-trip sanity", () => {
  it("preserves comments when modifying a value", () => {
    const src = `
# top comment
page-templates:
  default: { size: A4, margin: 0 }
design-tokens:
  color:
    ink: '#000'  # current ink
`;
    const doc = parseDocument(src);
    doc.setIn(["design-tokens", "color", "ink"], "#1a1a1a");
    const out = doc.toString();
    expect(out).toContain("# top comment");
    expect(out).toContain("# current ink");
    expect(out).toMatch(/ink:\s+["']?#1a1a1a/);
  });
});

describe("tokens list", () => {
  it("returns the resolved token set as JSON-shaped data", async () => {
    const tokens = await listTokens(join(fixturesDir, "design-tokens"));
    expect(tokens.color?.ink).toBe("#1a1a1a");
    expect(tokens.size?.body).toBe("11pt");
  });

  it("returns an empty object when design-tokens is absent", async () => {
    const tokens = await listTokens(join(fixturesDir, "hello"));
    expect(tokens).toEqual({});
  });

  it("formatTokensList renders categories and tokens", () => {
    const text = formatTokensList({
      color: { ink: "#1a1a1a", accent: "#FFE600" },
      size: { body: "11pt" }
    });
    expect(text).toContain("color");
    expect(text).toContain("ink");
    expect(text).toContain("#1a1a1a");
    expect(text).toContain("accent");
    expect(text).toContain("size");
    expect(text).toContain("body");
    expect(text).toMatch(/2 categories, 3 tokens/);
  });

  it("formatTokensList handles empty tokens", () => {
    expect(formatTokensList({})).toContain("No design tokens defined");
  });
});
