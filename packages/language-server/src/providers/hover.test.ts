import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideHover } from "./hover.js";
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

describe("hover", () => {
  it("returns markdown docs for a registered tag", () => {
    const index = syntheticIndex([
      {
        name: "row",
        params: ["label", "icon"],
        slots: ["suggested"],
        templateBody: '<div class="row">{{{body}}}</div>',
        isWrapper: false
      }
    ]);
    const document = md("<row>body</row>");
    const result = provideHover({
      index,
      document,
      position: { line: 0, character: 2 }
    });
    expect(result).not.toBeNull();
    const value = (result!.contents as { value: string }).value;
    expect(value).toContain("**row**");
    expect(value).toContain("params:");
    expect(value).toContain("label");
    expect(value).toContain("slots:");
    expect(value).toContain("{{{body}}}");
  });

  it("indicates a wrapper component vs a block-template component", () => {
    const wrapperIndex = syntheticIndex([
      { name: "callout", isWrapper: true, params: ["variant"] }
    ]);
    const document = md("<callout>x</callout>");
    const result = provideHover({
      index: wrapperIndex,
      document,
      position: { line: 0, character: 3 }
    });
    const value = (result!.contents as { value: string }).value;
    expect(value).toContain("wrapper component");
  });

  it("returns null when hovering over an unknown tag", () => {
    const index = syntheticIndex([{ name: "row" }]);
    const document = md("<unknown>x</unknown>");
    const result = provideHover({
      index,
      document,
      position: { line: 0, character: 3 }
    });
    expect(result).toBeNull();
  });

  it("returns null when hovering outside any tag", () => {
    const index = syntheticIndex([{ name: "row" }]);
    const document = md("<row>body</row>\n\nMore prose.");
    const result = provideHover({
      index,
      document,
      position: { line: 2, character: 5 }
    });
    expect(result).toBeNull();
  });

  it("works on the closer too, not just the opener", () => {
    const index = syntheticIndex([{ name: "row", params: [] }]);
    const document = md("<row>body</row>");
    const result = provideHover({
      index,
      document,
      position: { line: 0, character: 11 } // inside `</row>`
    });
    expect(result).not.toBeNull();
    expect((result!.contents as { value: string }).value).toContain("**row**");
  });

  it("returns null when index is null", () => {
    const document = md("<row>x</row>");
    const result = provideHover({
      index: null,
      document,
      position: { line: 0, character: 2 }
    });
    expect(result).toBeNull();
  });

  it("returns null for non-markdown documents", () => {
    const tenderDoc = TextDocument.create(
      "file:///p/components/row.tender",
      "tender",
      0,
      "---\nparams: [label]\n---\n"
    );
    const index = syntheticIndex([{ name: "row" }]);
    const result = provideHover({
      index,
      document: tenderDoc,
      position: { line: 1, character: 5 }
    });
    expect(result).toBeNull();
  });
});
