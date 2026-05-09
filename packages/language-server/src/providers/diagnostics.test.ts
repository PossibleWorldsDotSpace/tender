import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import { provideDiagnostics } from "./diagnostics.js";
import type { ProjectIndex, ComponentSymbol } from "../project-index.js";

function syntheticIndex(components: Partial<ComponentSymbol>[]): ProjectIndex {
  const map = new Map<string, ComponentSymbol>();
  for (const c of components) {
    const sym: ComponentSymbol = {
      name: c.name ?? "x",
      path: c.path ?? "/p/components/x.tender",
      inline: c.inline ?? false,
      params: c.params ?? [],
      slots: c.slots ?? [],
      templateBody: c.templateBody,
      isWrapper: c.isWrapper ?? c.templateBody === undefined
    };
    map.set(sym.name, sym);
  }
  return {
    projectDir: "/p",
    componentByName: map,
    pageTemplateByName: new Map(),
    inlineShortcuts: new Map(),
    projectDiagnostics: []
  };
}

function md(text: string): TextDocument {
  return TextDocument.create("file:///p/content.md", "markdown", 0, text);
}

describe("diagnostics — markdown registry checks", () => {
  it("flags an unknown component", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([{ name: "row" }]),
      document: md("<unknown>x</unknown>")
    });
    expect(result.length).toBe(1);
    expect(result[0]?.severity).toBe(DiagnosticSeverity.Error);
    expect(result[0]?.message).toMatch(/Unknown component "unknown"/);
  });

  it("flags an unknown attribute", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([{ name: "row", params: ["label"] }]),
      document: md(`<row badattr="x">body</row>`)
    });
    expect(result.length).toBe(1);
    expect(result[0]?.severity).toBe(DiagnosticSeverity.Warning);
    expect(result[0]?.message).toMatch(/Unknown attribute "badattr"/);
  });

  it("does not flag declared attributes", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([{ name: "row", params: ["label", "icon"] }]),
      document: md(`<row label="x" icon=clock>body</row>`)
    });
    expect(result).toEqual([]);
  });

  it("flags inline-only component used at block level", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([
        { name: "sd", inline: true, isWrapper: true }
      ]),
      document: md(`<sd>multi\nline body</sd>`)
    });
    expect(result.some(d =>
      d.severity === DiagnosticSeverity.Error
      && /inline-only/.test(d.message)
    )).toBe(true);
  });

  it("flags an undeclared slot marker inside a multi-slot component body", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([
        { name: "ad-lib", slots: ["suggested"] }
      ]),
      document: md(
        "<ad-lib>\n--- suggested ---\nA\n--- response ---\nB\n</ad-lib>"
      )
    });
    expect(result.length).toBe(1);
    expect(result[0]?.severity).toBe(DiagnosticSeverity.Warning);
    expect(result[0]?.message).toMatch(/Slot "response"/);
  });

  it("does not flag declared slot markers", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([
        { name: "ad-lib", slots: ["suggested", "response"] }
      ]),
      document: md(
        "<ad-lib>\n--- suggested ---\nA\n--- response ---\nB\n</ad-lib>"
      )
    });
    expect(result).toEqual([]);
  });

  it("recognizes @@ slot markers (item 5 form)", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([
        { name: "ad-lib", slots: ["suggested"] }
      ]),
      document: md(
        "<ad-lib>\n@@ suggested\nA\n@@ response\nB\n</ad-lib>"
      )
    });
    // `response` is undeclared; should warn.
    expect(result.length).toBe(1);
    expect(result[0]?.severity).toBe(DiagnosticSeverity.Warning);
    expect(result[0]?.message).toMatch(/Slot "response"/);
  });

  it("forwards parser diagnostics for unclosed tags", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([{ name: "row" }]),
      document: md("<row>body without closer")
    });
    expect(result.some(d => /not closed/.test(d.message))).toBe(true);
  });

  it("forwards parser diagnostics for stray closers", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([{ name: "row" }]),
      document: md("</row>")
    });
    expect(result.some(d => /no matching opener/.test(d.message))).toBe(true);
  });

  it("returns no registry diagnostics when index is null", () => {
    const result = provideDiagnostics({
      index: null,
      document: md("<unknown>x</unknown>")
    });
    // Recovery parser still runs; no registry checks; tag is a closed pair
    // with no parser-level diagnostic. So empty.
    expect(result).toEqual([]);
  });

  it("points unknown-tag diagnostic at the tag name itself, not the whole opener", () => {
    const result = provideDiagnostics({
      index: syntheticIndex([{ name: "row" }]),
      document: md(`<unknown attr="x">body</unknown>`)
    });
    const d = result[0]!;
    // Range should cover `unknown` (7 chars), starting at column 1 (just
    // past the `<`).
    expect(d.range.start).toEqual({ line: 0, character: 1 });
    expect(d.range.end).toEqual({ line: 0, character: 8 });
  });
});

describe("diagnostics — .tender file checks", () => {
  it("forwards tender-file-parser diagnostics", () => {
    const tenderDoc = TextDocument.create(
      "file:///p/components/row.tender",
      "tender",
      0,
      "---\nfoo: [\n---"
    );
    const result = provideDiagnostics({
      index: null,
      document: tenderDoc
    });
    expect(result.length).toBe(1);
    expect(result[0]?.message).toMatch(/Invalid frontmatter YAML/);
  });

  it("returns no diagnostics for a well-formed .tender file", () => {
    const tenderDoc = TextDocument.create(
      "file:///p/components/row.tender",
      "tender",
      0,
      "---\nparams: [label]\n---\n\n<div>{{{body}}}</div>\n"
    );
    const result = provideDiagnostics({
      index: null,
      document: tenderDoc
    });
    expect(result).toEqual([]);
  });
});

describe("diagnostics — non-tender, non-markdown files", () => {
  it("returns nothing for unrelated documents", () => {
    const doc = TextDocument.create(
      "file:///p/styles.css",
      "css",
      0,
      "<row>x</row>"
    );
    const result = provideDiagnostics({
      index: syntheticIndex([{ name: "row" }]),
      document: doc
    });
    expect(result).toEqual([]);
  });
});
