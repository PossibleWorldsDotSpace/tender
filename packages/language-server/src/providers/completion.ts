import type {
  CompletionItem,
  Position
} from "vscode-languageserver/node.js";
import { CompletionItemKind, InsertTextFormat } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ProjectIndex } from "../project-index.js";
import { parseTags } from "../parsers/tag-parser.js";

/**
 * Completion provider for `.md` and `.tender` files. Implements the four
 * contexts called out in impl plan §3.4:
 *
 * 1. After `<` in a `.md` file: list every registered component.
 * 2. Inside an opener's attribute area: list that component's params.
 * 3. At column 0 of a `.tender` frontmatter, after the user types a key
 *    fragment, surface the known schema keys (`params`, `slots`, …).
 * 4. After `{{` inside a `.tender` template body: list declared params and
 *    slots from this file's frontmatter.
 *
 * The provider is pure: caller passes the document + position + project
 * index, and we return CompletionItem[]. No side effects, no shared state.
 */

export interface CompletionContext {
  index: ProjectIndex | null;
  document: TextDocument;
  position: Position;
}

const FRONTMATTER_KEYS = [
  "params",
  "slots",
  "inline",
  "tag",
  "class",
  "extends"
];

export function provideCompletion(ctx: CompletionContext): CompletionItem[] {
  const path = uriPath(ctx.document.uri);
  if (path.endsWith(".tender")) return completeInTenderFile(ctx);
  if (path.endsWith(".md")) return completeInMarkdown(ctx);
  return [];
}

function completeInMarkdown(ctx: CompletionContext): CompletionItem[] {
  if (!ctx.index) return [];
  const text = ctx.document.getText();
  const offset = ctx.document.offsetAt(ctx.position);
  const before = text.slice(0, offset);

  // Case (1): we just typed `<` (or `<a` / `<ro`...). The character
  // immediately before the cursor is the start of a tag name, after a `<`.
  // Walk back to find a `<`; if anything between the `<` and the cursor is
  // not a name char, abandon — we're not in a tag-name context.
  const tagStart = findTagNameStart(before);
  if (tagStart !== null) {
    return [...ctx.index.componentByName.values()].map(c => ({
      label: c.name,
      kind: CompletionItemKind.Struct,
      detail: c.isWrapper
        ? `wrapper (${c.path.split("/").pop() ?? c.path})`
        : `template (${c.path.split("/").pop() ?? c.path})`,
      documentation: c.templateBody ? truncate(c.templateBody, 200) : undefined,
      // Snippet inserts `<name>$0</name>` for closed-pair components, or
      // `<name />` for inline-only. Self-close case is rarer; users can
      // type `/` themselves.
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: c.inline
        ? `${c.name}>$1</${c.name}>$0`
        : `${c.name}>\n$0\n</${c.name}>`
    }));
  }

  // Case (2): the cursor is inside an opener's attribute area. Run the
  // recovery tag parser; if any TagNode's openerRange contains the cursor,
  // surface that component's params.
  const { tags } = parseTags(text);
  for (const t of tags) {
    if (rangeContains(t.openerRange, ctx.position)) {
      const def = ctx.index.componentByName.get(t.name);
      if (!def) return [];
      // Suggest params not already present on the tag.
      const usedNames = new Set(t.attrs.map(a => a.name));
      return def.params
        .filter(p => !usedNames.has(p))
        .map(p => ({
          label: p,
          kind: CompletionItemKind.Property,
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `${p}="$0"`
        }));
    }
  }
  return [];
}

function completeInTenderFile(ctx: CompletionContext): CompletionItem[] {
  // For .tender files we need to know which section we're in. The recovery
  // parser already does that; we just classify the position against the
  // section ranges.
  const text = ctx.document.getText();
  const offset = ctx.document.offsetAt(ctx.position);
  const lineStart = lineStartOffset(text, offset);
  const lineToCursor = text.slice(lineStart, offset);

  // Frontmatter context: the cursor is in the frontmatter content range.
  // Two simple heuristics:
  //  - If the line is short (just a key fragment) and starts at column 0,
  //    suggest schema keys.
  //  - Otherwise leave completion to other tooling.
  // We don't strictly need the recovery parser to classify "inside
  // frontmatter" — we can just check whether we're between the first two
  // `---` lines. But the recovery parser already does this; reuse it.
  const fmRange = locateFrontmatter(text);
  if (fmRange && offset >= fmRange.start && offset < fmRange.end) {
    if (/^[a-zA-Z]*$/.test(lineToCursor)) {
      return FRONTMATTER_KEYS.filter(k => k.startsWith(lineToCursor)).map(k => ({
        label: k,
        kind: CompletionItemKind.Field,
        insertText: `${k}: `
      }));
    }
    return [];
  }

  // Template-body context: support `{{` and `{{{` triggers.
  // Look back from the cursor; if the immediately preceding text is `{{` or
  // `{{{`, surface the file's declared params/slots.
  if (lineToCursor.endsWith("{{") || lineToCursor.endsWith("{{{")) {
    const fm = parseFrontmatter(text);
    const params: string[] = Array.isArray(fm.params) ? fm.params : [];
    const slots: string[] = Array.isArray(fm.slots) ? fm.slots : [];
    const items: CompletionItem[] = [];
    for (const p of params) {
      items.push({ label: p, kind: CompletionItemKind.Variable, detail: "param" });
    }
    for (const s of slots) {
      items.push({ label: s, kind: CompletionItemKind.Variable, detail: "slot" });
    }
    items.push({ label: "body", kind: CompletionItemKind.Variable, detail: "default body slot" });
    return items;
  }
  return [];
}

/**
 * If `before` ends with `<` followed by zero or more name characters, return
 * the position of the `<`; else null. Used to decide whether the cursor is
 * in tag-name-completion context.
 */
function findTagNameStart(before: string): number | null {
  let i = before.length - 1;
  // Skip name characters (letters, digits, hyphens) walking backwards.
  while (i >= 0 && /[a-zA-Z0-9-]/.test(before[i]!)) i--;
  if (i < 0) return null;
  if (before[i] !== "<") return null;
  // After the `<` and before the consumed name, the next character must be
  // a letter (start of a tag name) — or the cursor is right after `<`.
  if (i + 1 < before.length && !/[a-zA-Z]/.test(before[i + 1]!)) return null;
  return i;
}

/**
 * Find the {start, end} byte offsets of the frontmatter content (the lines
 * between the `---` delimiters). Returns null when there's no frontmatter.
 * Mirrors parseTenderFileRecovery's logic but returns offsets directly so
 * the completion provider can compare against the cursor's offset.
 */
function locateFrontmatter(text: string): { start: number; end: number } | null {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return null;
  const after = text.indexOf("\n") + 1;
  // Find the next line that's exactly `---`.
  const lines = text.split("\n");
  let close = -1;
  for (let j = 1; j < lines.length; j++) {
    if (lines[j] === "---") { close = j; break; }
  }
  if (close === -1) return null;
  // Compute the offset of the start of the closing `---` line.
  let off = 0;
  for (let j = 0; j < close; j++) off += lines[j]!.length + 1;
  return { start: after, end: off };
}

/**
 * Pull the YAML frontmatter as a plain object. Defensive: returns {} on any
 * parse failure rather than throwing — the provider should be tolerant of
 * mid-keystroke YAML.
 */
function parseFrontmatter(text: string): Record<string, unknown> {
  const range = locateFrontmatter(text);
  if (!range) return {};
  const yamlText = text.slice(range.start, range.end);
  try {
    // js-yaml is a transitive dep; pull it from @tender/core's surface to
    // avoid importing it directly. But simpler: a tiny line-by-line YAML-ish
    // recognizer for `params: [a, b]` and `slots: [c]` is enough for the
    // completion case (these fields are arrays of strings or absent).
    const out: Record<string, unknown> = {};
    for (const line of yamlText.split("\n")) {
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9-]*):\s*\[([^\]]*)\]\s*$/);
      if (m) {
        out[m[1]!] = m[2]!.split(",").map(s => s.trim()).filter(Boolean);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function rangeContains(
  range: { start: Position; end: Position },
  pos: Position
): boolean {
  if (pos.line < range.start.line) return false;
  if (pos.line > range.end.line) return false;
  if (pos.line === range.start.line && pos.character < range.start.character) return false;
  if (pos.line === range.end.line && pos.character > range.end.character) return false;
  return true;
}

function lineStartOffset(text: string, offset: number): number {
  for (let i = offset - 1; i >= 0; i--) {
    if (text[i] === "\n") return i + 1;
  }
  return 0;
}

function uriPath(uri: string): string {
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

/**
 * Compute trigger characters the server should advertise. Static for now;
 * exported as a helper so server.ts and tests share one source.
 */
export const COMPLETION_TRIGGER_CHARACTERS = ["<", " ", "{", ":"];
