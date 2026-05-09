import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideDocumentSymbols } from "./document-symbols.js";

function tender(text: string): TextDocument {
  return TextDocument.create("file:///p/components/row.tender", "tender", 0, text);
}

describe("document-symbols", () => {
  it("surfaces all four sections when present", () => {
    const src = [
      "---",
      "params: [label]",
      "---",
      "",
      "<div>{{{body}}}</div>",
      "",
      "<style>",
      ".x{}",
      "</style>",
      "",
      "<palette>",
      "body: hi",
      "</palette>"
    ].join("\n");
    const symbols = provideDocumentSymbols({ document: tender(src) });
    expect(symbols.map(s => s.name)).toEqual(["frontmatter", "template", "style", "palette"]);
  });

  it("omits frontmatter when there is none", () => {
    const symbols = provideDocumentSymbols({
      document: tender("<div>{{{body}}}</div>")
    });
    expect(symbols.map(s => s.name)).toEqual(["template"]);
  });

  it("omits style and palette when absent", () => {
    const src = "---\nparams: [label]\n---\n\n<div>{{{body}}}</div>";
    const symbols = provideDocumentSymbols({ document: tender(src) });
    expect(symbols.map(s => s.name)).toEqual(["frontmatter", "template"]);
  });

  it("returns nothing for a non-.tender file", () => {
    const md = TextDocument.create(
      "file:///p/content.md",
      "markdown",
      0,
      "# Hello"
    );
    expect(provideDocumentSymbols({ document: md })).toEqual([]);
  });

  it("uses the section ranges from the recovery parser", () => {
    const src = "---\ntag: span\n---\n\n<span></span>";
    const symbols = provideDocumentSymbols({ document: tender(src) });
    const fm = symbols.find(s => s.name === "frontmatter")!;
    expect(fm.range.start.line).toBe(1);
    expect(fm.range.end.line).toBe(2);
  });
});
