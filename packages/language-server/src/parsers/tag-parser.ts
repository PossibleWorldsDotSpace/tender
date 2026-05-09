import { tryParseTag } from "@tender/core";
import type { TagToken, TagAttr } from "@tender/core";
import type { Range, Position, Diagnostic } from "vscode-languageserver/node.js";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";

/**
 * Recovery-oriented parser for content.md. Walks the buffer once, returns
 * every tag it can identify plus diagnostics for the malformed bits.
 *
 * This is the LSP's view onto tag structure. Where the production
 * preprocessor (PR 2.2) throws on first error so the build refuses to
 * produce a broken PDF, this parser keeps going so the editor can still
 * highlight, autocomplete, and offer hover docs while the user is mid-
 * keystroke.
 *
 * The two parsers must agree on what counts as a tag — see the corpus
 * tests in packages/core/test/fixtures/tag-corpus/.
 */

export interface TagNode {
  name: string;
  kind: "block" | "self-closing";
  attrs: AttrNode[];
  /** Full range covering opener-through-closer (or just the self-close). */
  range: Range;
  openerRange: Range;
  /** Undefined for self-closing tags. */
  closerRange?: Range;
  /** Undefined for self-closing tags. */
  bodyRange?: Range;
}

export interface AttrNode {
  name: string;
  value: string;
  nameRange: Range;
  /** Undefined when the attribute was used as a boolean (no `=value`). */
  valueRange?: Range;
}

export interface TagParseResult {
  tags: TagNode[];
  diagnostics: Diagnostic[];
}

interface StackEntry {
  opener: TagToken;
}

/**
 * Parse tag structure from `source`. The result is flat — nested tags
 * appear as multiple TagNodes with overlapping ranges, sorted by `range.start`.
 * Providers that care about hierarchy (e.g. document outline) can rebuild it
 * from the ranges, but most LSP features don't need to.
 */
export function parseTags(source: string): TagParseResult {
  const tags: TagNode[] = [];
  const diagnostics: Diagnostic[] = [];
  const stack: StackEntry[] = [];
  const lineIndex = buildLineIndex(source);

  let i = 0;
  while (i < source.length) {
    const skip = skipCodeOrComment(source, i);
    if (skip > i) { i = skip; continue; }
    if (source[i] !== "<") { i++; continue; }
    const tag = tryParseTag(source, i);
    if (!tag) { i++; continue; }

    if (tag.kind === "self-close") {
      tags.push(toSelfClosingNode(tag, source, lineIndex));
      i = tag.end;
      continue;
    }
    if (tag.kind === "open") {
      stack.push({ opener: tag });
      i = tag.end;
      continue;
    }
    // close
    const top = stack.pop();
    if (!top) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        message: `Closing tag </${tag.name}> has no matching opener.`,
        range: rangeOf(tag.start, tag.end, lineIndex)
      });
      i = tag.end;
      continue;
    }
    if (top.opener.name !== tag.name) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        message: `Expected </${top.opener.name}> but found </${tag.name}>.`,
        range: rangeOf(tag.start, tag.end, lineIndex)
      });
      // Recovery: discard `top` and treat the closer as if it had no opener.
      // We've already popped, so the next pop sees the prior outer; this is
      // the same recovery the production parser would do if we made it
      // continue past errors.
      i = tag.end;
      continue;
    }
    tags.push(toBlockNode(top.opener, tag, source, lineIndex));
    i = tag.end;
  }
  // Anything left on the stack is an unclosed opener — report each.
  for (const entry of stack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      message: `<${entry.opener.name}> is not closed before end of file.`,
      range: rangeOf(entry.opener.start, entry.opener.end, lineIndex)
    });
  }
  // Stable order: by start offset.
  tags.sort((a, b) => a.range.start.line - b.range.start.line
    || a.range.start.character - b.range.start.character);
  return { tags, diagnostics };
}

function toSelfClosingNode(tag: TagToken, source: string, idx: LineIndex): TagNode {
  return {
    name: tag.name,
    kind: "self-closing",
    attrs: tag.attrs.map(a => attrToNode(a, idx)),
    range: rangeOf(tag.start, tag.end, idx),
    openerRange: rangeOf(tag.start, tag.end, idx)
  };
}

function toBlockNode(opener: TagToken, closer: TagToken, source: string, idx: LineIndex): TagNode {
  return {
    name: opener.name,
    kind: "block",
    attrs: opener.attrs.map(a => attrToNode(a, idx)),
    range: rangeOf(opener.start, closer.end, idx),
    openerRange: rangeOf(opener.start, opener.end, idx),
    closerRange: rangeOf(closer.start, closer.end, idx),
    bodyRange: rangeOf(opener.end, closer.start, idx)
  };
}

function attrToNode(a: TagAttr, idx: LineIndex): AttrNode {
  return {
    name: a.name,
    value: a.value,
    nameRange: rangeOf(a.nameStart, a.nameEnd, idx),
    valueRange: a.valueStart !== undefined && a.valueEnd !== undefined
      ? rangeOf(a.valueStart, a.valueEnd, idx)
      : undefined
  };
}

/**
 * Skip past fenced code blocks (```…``` or ~~~…~~~), inline code spans
 * (`…`), and HTML comments (<!-- … -->). Mirrors the rules used by
 * preprocessTags so the two parsers agree on what's in vs. out of code.
 */
function skipCodeOrComment(source: string, i: number): number {
  if (source.startsWith("<!--", i)) {
    const end = source.indexOf("-->", i + 4);
    return end === -1 ? source.length : end + 3;
  }
  const atLineStart = i === 0 || source[i - 1] === "\n";
  if (atLineStart) {
    if (source.startsWith("```", i) || source.startsWith("~~~", i)) {
      const fence = source[i]!;
      const fenceLen = countSameChar(source, i, fence);
      const lineEnd = source.indexOf("\n", i);
      const after = lineEnd === -1 ? source.length : lineEnd + 1;
      let j = after;
      while (j < source.length) {
        if (source[j] === fence && countSameChar(source, j, fence) >= fenceLen) {
          const k = source.indexOf("\n", j);
          return k === -1 ? source.length : k + 1;
        }
        const nl = source.indexOf("\n", j);
        j = nl === -1 ? source.length : nl + 1;
      }
      return source.length;
    }
  }
  if (source[i] === "`") {
    const len = countSameChar(source, i, "`");
    const closer = "`".repeat(len);
    const start = i + len;
    const end = source.indexOf(closer, start);
    return end === -1 ? i : end + len;
  }
  return i;
}

function countSameChar(source: string, i: number, ch: string): number {
  let n = 0;
  while (i + n < source.length && source[i + n] === ch) n++;
  return n;
}

/**
 * Index from byte offset → 0-indexed line/column. Built once per parse and
 * reused for every range conversion.
 */
type LineIndex = number[];

function buildLineIndex(source: string): LineIndex {
  // Each entry is the offset of the start of a line. Line 0 starts at 0;
  // line N starts immediately after the Nth newline.
  const out: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") out.push(i + 1);
  }
  return out;
}

function offsetToPosition(offset: number, idx: LineIndex): Position {
  // Binary-search the line index for the largest line-start ≤ offset.
  let lo = 0, hi = idx.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (idx[mid]! <= offset) lo = mid; else hi = mid - 1;
  }
  return { line: lo, character: offset - idx[lo]! };
}

function rangeOf(start: number, end: number, idx: LineIndex): Range {
  return {
    start: offsetToPosition(start, idx),
    end: offsetToPosition(end, idx)
  };
}
