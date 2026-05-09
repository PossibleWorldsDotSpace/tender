import type { DocumentSymbol } from "vscode-languageserver/node.js";
import { SymbolKind } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { parseTenderFileRecovery } from "../parsers/tender-file-parser.js";

/**
 * Document-symbol provider for `.tender` files. Surfaces the four sections
 * (frontmatter, template, style, palette) as a symbol outline so VS Code's
 * Outline view and breadcrumbs work without needing language-specific
 * symbol indexing on the user's machine.
 *
 * Markdown buffers don't get a custom outline — the existing Markdown
 * outline (heading-based) is the right one for content authoring.
 */

export interface DocumentSymbolsContext {
  document: TextDocument;
}

export function provideDocumentSymbols(ctx: DocumentSymbolsContext): DocumentSymbol[] {
  const path = uriPath(ctx.document.uri);
  if (!path.endsWith(".tender")) return [];

  const r = parseTenderFileRecovery(ctx.document.getText());
  const out: DocumentSymbol[] = [];
  if (r.frontmatterRange) {
    out.push({
      name: "frontmatter",
      detail: "YAML",
      kind: SymbolKind.Property,
      range: r.frontmatterRange,
      selectionRange: r.frontmatterRange
    });
  }
  out.push({
    name: "template",
    detail: "Handlebars",
    kind: SymbolKind.Module,
    range: r.templateRange,
    selectionRange: r.templateRange
  });
  if (r.styleRange) {
    out.push({
      name: "style",
      detail: "CSS",
      kind: SymbolKind.Module,
      range: r.styleRange,
      selectionRange: r.styleRange
    });
  }
  if (r.paletteRange) {
    out.push({
      name: "palette",
      detail: "YAML",
      kind: SymbolKind.Property,
      range: r.paletteRange,
      selectionRange: r.paletteRange
    });
  }
  return out;
}

function uriPath(uri: string): string {
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
}
