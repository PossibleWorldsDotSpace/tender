import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";
import { listTokens, formatTokensList, setToken } from "./tokens.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

describe("tokens set", () => {
  it("updates an existing token, preserving comments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `# top comment
page-templates:
  default: { size: A4, margin: 0 }

design-tokens:
  color:
    ink: '#000'  # original
`);
      const result = await setToken(dir, "color.ink", "#1a1a1a");
      expect(result.previous).toBe("#000");
      expect(result.next).toBe("#1a1a1a");
      expect(result.created).toBe(false);
      const after = await readFile(join(dir, "project.yaml"), "utf8");
      expect(after).toContain("# top comment");
      expect(after).toContain("# original");
      expect(after).toMatch(/ink:\s+["']?#1a1a1a/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates a new token in an existing category", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `page-templates:
  default: { size: A4, margin: 0 }

design-tokens:
  color:
    ink: '#000'
`);
      const result = await setToken(dir, "color.brand", "#abc");
      expect(result.created).toBe(true);
      expect(result.next).toBe("#abc");
      const after = await readFile(join(dir, "project.yaml"), "utf8");
      expect(after).toMatch(/brand:\s+["']?#abc/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the design-tokens block and category if neither exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `page-templates:
  default: { size: A4, margin: 0 }
`);
      const result = await setToken(dir, "color.ink", "#000");
      expect(result.created).toBe(true);
      const after = await readFile(join(dir, "project.yaml"), "utf8");
      expect(after).toContain("design-tokens:");
      expect(after).toContain("color:");
      expect(after).toMatch(/ink:\s+["']?#000/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects token paths that aren't `category.name`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `page-templates:
  default: { size: A4, margin: 0 }
`);
      await expect(setToken(dir, "color", "#000")).rejects.toThrow(/category.name/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
