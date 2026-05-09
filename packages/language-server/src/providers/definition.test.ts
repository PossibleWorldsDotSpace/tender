import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideDefinition } from "./definition.js";
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

function tender(uri: string, text: string): TextDocument {
  return TextDocument.create(uri, "tender", 0, text);
}

describe("definition — markdown context", () => {
  it("jumps to the component file when the cursor is on a tag name", () => {
    const index = syntheticIndex([
      { name: "row", path: "/p/components/row.tender" }
    ]);
    const result = provideDefinition({
      index,
      document: md("<row>body</row>"),
      position: { line: 0, character: 2 }
    });
    expect(result).not.toBeNull();
    const loc = result as import("vscode-languageserver/node.js").Location;
    expect(loc.uri).toBe("file:///p/components/row.tender");
    expect(loc.range.start).toEqual({ line: 0, character: 0 });
  });

  it("jumps from the closer too", () => {
    const index = syntheticIndex([
      { name: "row", path: "/p/components/row.tender" }
    ]);
    const result = provideDefinition({
      index,
      document: md("<row>body</row>"),
      position: { line: 0, character: 11 }
    });
    expect(result).not.toBeNull();
  });

  it("returns null when the cursor is on an unknown tag", () => {
    const index = syntheticIndex([{ name: "row" }]);
    const result = provideDefinition({
      index,
      document: md("<unknown>x</unknown>"),
      position: { line: 0, character: 2 }
    });
    expect(result).toBeNull();
  });

  it("returns null when the cursor is outside any tag", () => {
    const index = syntheticIndex([{ name: "row" }]);
    const result = provideDefinition({
      index,
      document: md("<row>body</row>\n\nMore prose."),
      position: { line: 2, character: 5 }
    });
    expect(result).toBeNull();
  });

  it("returns null when index is null", () => {
    const result = provideDefinition({
      index: null,
      document: md("<row>x</row>"),
      position: { line: 0, character: 2 }
    });
    expect(result).toBeNull();
  });
});

describe("definition — .tender template body context", () => {
  it("jumps from {{label}} to its frontmatter declaration", () => {
    const src = "---\nparams: [label, icon]\n---\n\n<div>{{label}}</div>";
    const document = tender("file:///p/components/row.tender", src);
    // {{label}} starts at line 4, character 5; the `label` text is at 7..12.
    const result = provideDefinition({
      index: null,
      document,
      position: { line: 4, character: 9 }
    });
    expect(result).not.toBeNull();
    const loc = result as import("vscode-languageserver/node.js").Location;
    expect(loc.uri).toBe("file:///p/components/row.tender");
    // The frontmatter `params: [label, icon]` is on line 1; `label` starts
    // at character 9 (after `params: [`).
    expect(loc.range.start.line).toBe(1);
    const text = src.slice(
      document.offsetAt(loc.range.start),
      document.offsetAt(loc.range.end)
    );
    expect(text).toBe("label");
  });

  it("jumps from {{{slot}}} to its frontmatter declaration", () => {
    const src = "---\nslots: [suggested]\n---\n\n<div>{{{suggested}}}</div>";
    const document = tender("file:///p/components/ad-lib.tender", src);
    const result = provideDefinition({
      index: null,
      document,
      position: { line: 4, character: 12 }
    });
    expect(result).not.toBeNull();
    const loc = result as import("vscode-languageserver/node.js").Location;
    const text = src.slice(
      document.offsetAt(loc.range.start),
      document.offsetAt(loc.range.end)
    );
    expect(text).toBe("suggested");
  });

  it("returns null for an undeclared reference", () => {
    const src = "---\nparams: [label]\n---\n\n<div>{{nope}}</div>";
    const document = tender("file:///p/components/row.tender", src);
    const result = provideDefinition({
      index: null,
      document,
      position: { line: 4, character: 8 }
    });
    expect(result).toBeNull();
  });

  it("returns null when the cursor is not on a Handlebars reference", () => {
    const src = "---\nparams: [label]\n---\n\n<div>just text</div>";
    const document = tender("file:///p/components/row.tender", src);
    const result = provideDefinition({
      index: null,
      document,
      position: { line: 4, character: 7 }
    });
    expect(result).toBeNull();
  });
});
