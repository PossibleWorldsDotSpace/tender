import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTags } from "./tag-parser.js";
import type { TagNode } from "./tag-parser.js";
import type { Range } from "vscode-languageserver/node.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "../../../core/test/fixtures/tag-corpus");

interface ExpectedTag {
  name: string;
  kind: "block" | "self-closing";
  range: [[number, number], [number, number]];
  openerRange: [[number, number], [number, number]];
  closerRange?: [[number, number], [number, number]];
  bodyRange?: [[number, number], [number, number]];
}

interface Expected {
  tags: ExpectedTag[];
  diagnosticCount: number;
}

function rangeToTuples(r: Range): [[number, number], [number, number]] {
  return [
    [r.start.line, r.start.character],
    [r.end.line, r.end.character]
  ];
}

function compactTag(t: TagNode) {
  const out: ExpectedTag = {
    name: t.name,
    kind: t.kind,
    range: rangeToTuples(t.range),
    openerRange: rangeToTuples(t.openerRange)
  };
  if (t.closerRange) out.closerRange = rangeToTuples(t.closerRange);
  if (t.bodyRange) out.bodyRange = rangeToTuples(t.bodyRange);
  return out;
}

describe("tag-parser corpus", () => {
  it("locates the corpus directory", async () => {
    const entries = await readdir(corpusDir);
    expect(entries.length).toBeGreaterThan(0);
  });

  // Each .md file paired with a .expected.json drives one test case. This is
  // the sharp half of the equivalence story — the production preprocessTags
  // tests (in @tender/core) consume the same corpus.
  it.each([
    "simple-block",
    "with-attrs",
    "nested",
    "self-closing",
    "unclosed",
    "mismatched",
    "inside-code",
    "inside-fenced"
  ])("matches expected for %s", async (name) => {
    const source = await readFile(join(corpusDir, `${name}.md`), "utf8");
    const expected: Expected = JSON.parse(
      await readFile(join(corpusDir, `${name}.expected.json`), "utf8")
    );
    const result = parseTags(source);
    expect(result.diagnostics.length).toBe(expected.diagnosticCount);
    expect(result.tags.map(compactTag)).toEqual(expected.tags);
  });
});

describe("tag-parser recovery (LSP-only behaviors)", () => {
  it("emits a diagnostic instead of throwing on unclosed tags", () => {
    const result = parseTags("<row>body");
    expect(result.tags).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.message).toMatch(/not closed/);
  });

  it("emits a diagnostic instead of throwing on mismatched closers", () => {
    const result = parseTags("<row>body</callout>");
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0]?.message).toMatch(/Expected/);
  });

  it("emits a diagnostic on a stray closer", () => {
    const result = parseTags("</row>");
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.message).toMatch(/no matching opener/);
  });

  it("returns attribute ranges suitable for LSP highlighting", () => {
    const result = parseTags(`<row label="x">body</row>`);
    expect(result.tags.length).toBe(1);
    const attr = result.tags[0]!.attrs[0]!;
    expect(attr.name).toBe("label");
    expect(attr.value).toBe("x");
    expect(attr.nameRange.start.character).toBe(5);
    expect(attr.nameRange.end.character).toBe(10);
    expect(attr.valueRange).toBeDefined();
  });

  it("preserves boolean attribute as value=true with no valueRange", () => {
    const result = parseTags(`<row no-break>body</row>`);
    const attr = result.tags[0]!.attrs[0]!;
    expect(attr.name).toBe("no-break");
    expect(attr.value).toBe("true");
    expect(attr.valueRange).toBeUndefined();
  });

  it("converts byte offsets to LSP positions across multiple lines", () => {
    const source = "first line\n<row>\nbody\n</row>\n";
    const result = parseTags(source);
    expect(result.tags.length).toBe(1);
    const t = result.tags[0]!;
    expect(t.openerRange.start).toEqual({ line: 1, character: 0 });
    expect(t.openerRange.end).toEqual({ line: 1, character: 5 });
    expect(t.closerRange?.start).toEqual({ line: 3, character: 0 });
    expect(t.closerRange?.end).toEqual({ line: 3, character: 6 });
  });
});
