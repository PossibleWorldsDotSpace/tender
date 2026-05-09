import type { Definition, Location, Position, Range } from "vscode-languageserver/node.js";
import { pathToFileURL } from "node:url";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ProjectIndex } from "../project-index.js";
import { parseTags } from "../parsers/tag-parser.js";
import { parseTenderFileRecovery } from "../parsers/tender-file-parser.js";

/**
 * Definition provider.
 *
 * In a `.md` file: hovering on a tag name and triggering "go to definition"
 * jumps to the component's source file. The whole file is the target — VS
 * Code opens it at line 0 — which is plenty for a v1 UX. PR 3.x can refine
 * this to point at the frontmatter `tag` or `template` field.
 *
 * In a `.tender` file: clicking on `{{name}}` or `{{{name}}}` inside the
 * template body jumps to the matching entry in the file's frontmatter
 * `params:` or `slots:` list. We don't claim definitions for the synthetic
 * `body` slot — it has no preimage.
 */

export interface DefinitionContext {
  index: ProjectIndex | null;
  document: TextDocument;
  position: Position;
}

export function provideDefinition(ctx: DefinitionContext): Definition | null {
  const path = uriPath(ctx.document.uri);
  if (path.endsWith(".md")) return defineFromMarkdown(ctx);
  if (path.endsWith(".tender")) return defineFromTender(ctx);
  return null;
}

function defineFromMarkdown(ctx: DefinitionContext): Definition | null {
  if (!ctx.index) return null;
  const text = ctx.document.getText();
  const { tags } = parseTags(text);
  for (const t of tags) {
    if (rangeContains(t.openerRange, ctx.position) || rangeContains(t.closerRange, ctx.position)) {
      const def = ctx.index.componentByName.get(t.name);
      if (!def) return null;
      const target: Location = {
        uri: pathToFileURL(def.path).href,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
      };
      return target;
    }
  }
  return null;
}

const HBARS_REF_RE = /\{\{\{?([\w-]+)\}?\}\}/g;

function defineFromTender(ctx: DefinitionContext): Definition | null {
  const text = ctx.document.getText();
  const offset = ctx.document.offsetAt(ctx.position);

  // Walk Handlebars references in the buffer; find one whose name range
  // contains the cursor.
  let match: RegExpExecArray | null;
  HBARS_REF_RE.lastIndex = 0;
  while ((match = HBARS_REF_RE.exec(text))) {
    const name = match[1]!;
    const refStart = match.index;
    const refEnd = refStart + match[0].length;
    if (offset < refStart || offset > refEnd) continue;
    return frontmatterRefLocation(ctx.document, text, name);
  }
  return null;
}

/**
 * Find a `params:` or `slots:` frontmatter list and the offset of `name`
 * within it. Returns a Location pointing at that name, or null when the
 * name isn't declared.
 */
function frontmatterRefLocation(
  document: TextDocument,
  text: string,
  name: string
): Location | null {
  const file = parseTenderFileRecovery(text);
  if (!file.frontmatterRange) return null;
  const fmStartOffset = document.offsetAt(file.frontmatterRange.start);
  const fmEndOffset = document.offsetAt(file.frontmatterRange.end);
  const fm = text.slice(fmStartOffset, fmEndOffset);
  // Find a line of the form `params: [a, b, name]` or `slots: [name]`.
  let lineOffset = 0;
  for (const line of fm.split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9-]*)\s*:\s*\[([^\]]*)\]/);
    if (m && (m[1] === "params" || m[1] === "slots")) {
      const list = m[2]!;
      const items = list.split(",");
      // Walk char-by-char to find `name`. We could regex-match a word
      // boundary, but slicing the source preserves the exact offsets.
      let cursor = list.indexOf("[") >= 0 ? 0 : 0;
      const listStartInLine = m[0]!.indexOf("[") + 1; // index of first char inside `[`
      let itemStart = listStartInLine;
      for (const item of items) {
        const trimmed = item.trim();
        if (trimmed === name) {
          const inItemOffset = item.indexOf(trimmed);
          const startInLine = itemStart + inItemOffset;
          const startOffset = fmStartOffset + lineOffset + startInLine;
          const endOffset = startOffset + name.length;
          const range: Range = {
            start: document.positionAt(startOffset),
            end: document.positionAt(endOffset)
          };
          return { uri: document.uri, range };
        }
        itemStart += item.length + 1; // +1 for the comma
        cursor++;
      }
    }
    lineOffset += line.length + 1; // +1 for the \n
  }
  return null;
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
