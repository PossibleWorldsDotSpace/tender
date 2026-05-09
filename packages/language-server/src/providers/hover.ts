import type { Hover, MarkupContent, Position } from "vscode-languageserver/node.js";
import { MarkupKind } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ProjectIndex, ComponentSymbol } from "../project-index.js";
import { parseTags } from "../parsers/tag-parser.js";

/**
 * Hover provider for `.md` files: hovering over a tag name surfaces the
 * component's source path, params, slots, and a truncated template body.
 *
 * `.tender`-file hover (e.g. `{{label}}` ↔ frontmatter param declaration)
 * is deferred to PR 3.5 — it pairs naturally with the definition provider.
 */

export interface HoverContext {
  index: ProjectIndex | null;
  document: TextDocument;
  position: Position;
}

export function provideHover(ctx: HoverContext): Hover | null {
  if (!ctx.index) return null;
  const path = uriPath(ctx.document.uri);
  if (!path.endsWith(".md")) return null;

  const text = ctx.document.getText();
  const { tags } = parseTags(text);
  // Find a tag whose opener (or closer) range contains the cursor.
  for (const t of tags) {
    if (rangeContains(t.openerRange, ctx.position) || rangeContains(t.closerRange, ctx.position)) {
      const def = ctx.index.componentByName.get(t.name);
      if (!def) return null;
      return {
        contents: renderComponentDocs(def),
        range: t.openerRange
      };
    }
  }
  return null;
}

function renderComponentDocs(c: ComponentSymbol): MarkupContent {
  const lines: string[] = [];
  lines.push(`**${c.name}**`);
  lines.push("");
  lines.push(c.isWrapper ? "_wrapper component_" : "_block-template component_");
  if (c.params.length > 0) lines.push(`- params: \`${c.params.join(", ")}\``);
  if (c.slots.length > 0) lines.push(`- slots: \`${c.slots.join(", ")}\``);
  if (c.inline) lines.push(`- inline-only`);
  lines.push("");
  lines.push(`source: \`${shortPath(c.path)}\``);
  if (c.templateBody) {
    lines.push("");
    lines.push("```handlebars");
    lines.push(truncate(c.templateBody, 600));
    lines.push("```");
  }
  return { kind: MarkupKind.Markdown, value: lines.join("\n") };
}

function rangeContains(
  range: { start: Position; end: Position } | undefined,
  pos: Position
): boolean {
  if (!range) return false;
  if (pos.line < range.start.line) return false;
  if (pos.line > range.end.line) return false;
  if (pos.line === range.start.line && pos.character < range.start.character) return false;
  if (pos.line === range.end.line && pos.character > range.end.character) return false;
  return true;
}

function uriPath(uri: string): string {
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
}

function shortPath(path: string): string {
  // Show the last two segments — usually `components/foo.tender`. Long
  // absolute paths in hover popups are noisy.
  const parts = path.split("/");
  return parts.slice(-2).join("/");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}
