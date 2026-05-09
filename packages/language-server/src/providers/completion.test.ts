import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideCompletion } from "./completion.js";
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

function md(uri: string, text: string): TextDocument {
  return TextDocument.create(uri, "markdown", 0, text);
}

function tender(uri: string, text: string): TextDocument {
  return TextDocument.create(uri, "tender", 0, text);
}

describe("completion — markdown context", () => {
  it("suggests components after `<`", () => {
    const index = syntheticIndex([
      { name: "row", params: ["label"] },
      { name: "callout", isWrapper: true, params: ["variant"] }
    ]);
    const document = md("file:///p/content.md", "<");
    const items = provideCompletion({
      index,
      document,
      position: { line: 0, character: 1 }
    });
    expect(items.map(i => i.label).sort()).toEqual(["callout", "row"]);
  });

  it("filters by partial typed name", () => {
    const index = syntheticIndex([
      { name: "row" },
      { name: "callout" }
    ]);
    const document = md("file:///p/content.md", "<ro");
    const items = provideCompletion({
      index,
      document,
      position: { line: 0, character: 3 }
    });
    // VS Code does its own filtering; we surface every component and let
    // the client narrow. Both names appear here.
    expect(items.map(i => i.label).sort()).toEqual(["callout", "row"]);
  });

  it("does not suggest tag-name completions outside a `<` context", () => {
    const index = syntheticIndex([{ name: "row" }]);
    const document = md("file:///p/content.md", "Just a paragraph.");
    const items = provideCompletion({
      index,
      document,
      position: { line: 0, character: 17 }
    });
    expect(items).toEqual([]);
  });

  it("suggests params inside an opener's attribute area", () => {
    const index = syntheticIndex([
      { name: "row", params: ["label", "icon", "no-break"] }
    ]);
    const document = md("file:///p/content.md", "<row >body</row>");
    // Cursor sits after the space at column 5.
    const items = provideCompletion({
      index,
      document,
      position: { line: 0, character: 5 }
    });
    expect(items.map(i => i.label).sort()).toEqual(["icon", "label", "no-break"]);
  });

  it("filters out params already present on the tag", () => {
    const index = syntheticIndex([
      { name: "row", params: ["label", "icon", "no-break"] }
    ]);
    const document = md("file:///p/content.md", `<row label="x" >body</row>`);
    const items = provideCompletion({
      index,
      document,
      position: { line: 0, character: 15 }
    });
    expect(items.map(i => i.label).sort()).toEqual(["icon", "no-break"]);
  });

  it("returns nothing in markdown when index is null", () => {
    const document = md("file:///p/content.md", "<");
    const items = provideCompletion({
      index: null,
      document,
      position: { line: 0, character: 1 }
    });
    expect(items).toEqual([]);
  });
});

describe("completion — .tender frontmatter context", () => {
  it("suggests schema keys after the user types a fragment at column 0", () => {
    const document = tender(
      "file:///p/components/row.tender",
      "---\np\n---\n"
    );
    // Cursor after `p` on line 1, column 1.
    const items = provideCompletion({
      index: null,
      document,
      position: { line: 1, character: 1 }
    });
    expect(items.map(i => i.label).sort()).toEqual(["params"]);
  });

  it("returns all schema keys at start of line", () => {
    const document = tender(
      "file:///p/components/row.tender",
      "---\n\n---\n"
    );
    const items = provideCompletion({
      index: null,
      document,
      position: { line: 1, character: 0 }
    });
    // All keys when there's no prefix to filter.
    expect(items.map(i => i.label).sort()).toEqual(
      ["class", "extends", "inline", "params", "slots", "tag"]
    );
  });
});

describe("completion — .tender template body context", () => {
  it("suggests declared params after `{{`", () => {
    const document = tender(
      "file:///p/components/row.tender",
      "---\nparams: [label, icon]\n---\n\n<div>{{"
    );
    const items = provideCompletion({
      index: null,
      document,
      position: { line: 4, character: 7 }
    });
    expect(items.map(i => i.label).sort()).toEqual(["body", "icon", "label"]);
  });

  it("includes slots as well as params", () => {
    const document = tender(
      "file:///p/components/ad-lib.tender",
      "---\nslots: [suggested]\nparams: [x]\n---\n\n<div>{{{"
    );
    const items = provideCompletion({
      index: null,
      document,
      position: { line: 5, character: 8 }
    });
    expect(items.map(i => i.label).sort()).toEqual(["body", "suggested", "x"]);
  });
});
