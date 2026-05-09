import { tryParseTag } from "./try-parse-tag.js";
import type { TagToken, TagAttr } from "./try-parse-tag.js";

/**
 * Rewrites <name attr="…">body</name> into the directive form remark-directive
 * already understands: `:::name{attr="…"}\n\nbody\n\n:::` for block components,
 * `:name[body]{attr="…"}` for inline components.
 *
 * The output is fed straight into `remarkParse → remarkDirective`, which
 * means the rest of the parser pipeline (resolveComponents, remark-rehype)
 * doesn't change. The preprocessor is sugar over an existing AST shape, not a
 * new pipeline.
 *
 * Algorithm (see impl plan §2.7):
 *
 * 1. Scan once with a stack to collect every top-level pair of registered
 *    open/close tags (and any self-closing registered tags). "Top-level"
 *    means at stack depth 0 — pairs that nest inside another registered
 *    opener are deliberately ignored at this level; recursion handles them.
 * 2. Walk the source in order, copying char-for-char, splicing each top-
 *    level pair with the rendered directive form. For a pair with a body,
 *    recursively run the preprocessor on the body before splicing.
 *
 * Edge cases handled:
 *
 * - Tags whose names are not in the registry pass through verbatim.
 * - Mismatched close (top-of-stack name differs from closer's name) is a
 *   hard error with both positions.
 * - Unclosed open at end of source is a hard error.
 * - Fenced code blocks (```…``` or ~~~…~~~) and inline code (`…`) are
 *   skipped entirely; tags inside are passed through unchanged.
 * - HTML comments (<!--…-->) are skipped.
 */

export interface PreprocessOptions {
  /** Names of registered components/templates. Tags outside this set are left alone. */
  registry: ReadonlySet<string>;
  /** Inline-only components — these render as `:name[body]{…}` (single colon). */
  inlineNames: ReadonlySet<string>;
  /** Source filename for error messages. Optional. */
  filename?: string;
}

export interface SourceMapEntry {
  /** Offset in the rewritten output. */
  rewrittenStart: number;
  /** Offset in the original input. */
  originalStart: number;
  /** Number of characters this segment covers (in rewritten output). */
  length: number;
}

export interface PreprocessResult {
  /** Source with registered component tags rewritten as directive form. */
  source: string;
  /**
   * Position-mapping table so downstream errors can be remapped to the
   * original source's offsets. Each entry covers a contiguous run of
   * rewritten characters that map 1-1 onto an original-source range; the
   * synthesized `:::name{…}\n\n` and `\n\n:::` sentinels are not represented
   * (those have no original-source preimage).
   */
  sourceMap: SourceMapEntry[];
}

interface OuterPair {
  opener: TagToken;
  closer: TagToken | null; // null → self-close
}

export function preprocessTags(source: string, opts: PreprocessOptions): PreprocessResult {
  const sourceMap: SourceMapEntry[] = [];
  const result = scan(source, opts, sourceMap, 0);
  return { source: result, sourceMap };
}

function scan(
  source: string,
  opts: PreprocessOptions,
  sourceMap: SourceMapEntry[],
  baseRewrittenOffset: number
): string {
  const pairs = findOuterPairs(source, opts);
  let out = "";
  let cursor = 0;
  for (const pair of pairs) {
    // Copy literal range before this pair, recording a 1-1 map entry.
    if (pair.opener.start > cursor) {
      const literal = source.slice(cursor, pair.opener.start);
      pushMap(sourceMap, baseRewrittenOffset + out.length, cursor, literal.length);
      out += literal;
    }
    const inlineMode = opts.inlineNames.has(pair.opener.name);
    const attrs = renderAttrs(pair.opener.attrs);
    if (pair.closer == null) {
      // Self-close: empty body. Inline-only components self-close to an
      // empty `:name[]{attrs}`; block components self-close to a no-body
      // `:::name{attrs}\n\n:::`.
      if (inlineMode) {
        out += `:${pair.opener.name}[]${attrs}`;
      } else {
        out += `\n\n:::${pair.opener.name}${attrs}\n\n:::\n\n`;
      }
      cursor = pair.opener.end;
      continue;
    }
    const bodyStart = pair.opener.end;
    const bodyEnd = pair.closer.start;
    const body = source.slice(bodyStart, bodyEnd);
    const head = inlineMode
      ? `:${pair.opener.name}[`
      : `\n\n:::${pair.opener.name}${attrs}\n\n`;
    const tail = inlineMode
      ? `]${attrs}`
      : `\n\n:::\n\n`;
    const bodyRewrittenOffset = baseRewrittenOffset + out.length + head.length;
    // Recurse on the body so nested registered tags get rewritten too.
    const subMap: SourceMapEntry[] = [];
    const innerProcessed = scan(body, opts, subMap, bodyRewrittenOffset);
    for (const e of subMap) {
      sourceMap.push({
        rewrittenStart: e.rewrittenStart,
        originalStart: e.originalStart + bodyStart,
        length: e.length
      });
    }
    out += head + innerProcessed + tail;
    cursor = pair.closer.end;
  }
  // Copy any trailing literal content.
  if (cursor < source.length) {
    const tail = source.slice(cursor);
    pushMap(sourceMap, baseRewrittenOffset + out.length, cursor, tail.length);
    out += tail;
  }
  return out;
}

function pushMap(map: SourceMapEntry[], rewrittenStart: number, originalStart: number, length: number) {
  if (length === 0) return;
  // Coalesce adjacent entries when both ranges are contiguous, so the map
  // stays small even for source with many literal chars between tags.
  const last = map[map.length - 1];
  if (last && last.rewrittenStart + last.length === rewrittenStart
           && last.originalStart + last.length === originalStart) {
    last.length += length;
    return;
  }
  map.push({ rewrittenStart, originalStart, length });
}

/**
 * Walk the source once with a stack. Skip code regions and comments.
 * Whenever we see a registered opener, push it. A closer pops; mismatched
 * closer (different name from top of stack) is an error. When the stack
 * returns to empty after a pop, that pair is recorded as a top-level pair.
 *
 * Self-close tokens at depth 0 are also recorded as outer pairs.
 *
 * Tags whose names aren't in the registry are skipped past as if they were
 * literal characters (we still advance past them so we don't re-tokenize
 * partially).
 */
function findOuterPairs(source: string, opts: PreprocessOptions): OuterPair[] {
  const pairs: OuterPair[] = [];
  const stack: TagToken[] = [];
  let topLevelOpener: TagToken | null = null;
  let i = 0;
  while (i < source.length) {
    const skip = skipCodeOrComment(source, i);
    if (skip > i) { i = skip; continue; }
    if (source[i] !== "<") { i++; continue; }
    const tag = tryParseTag(source, i);
    if (!tag) { i++; continue; }
    if (!opts.registry.has(tag.name)) {
      // Not registered: pass through. Advance past the tag so we don't try
      // to re-tokenize sub-strings of it.
      i = tag.end;
      continue;
    }
    if (tag.kind === "self-close") {
      if (stack.length === 0) {
        pairs.push({ opener: tag, closer: null });
      }
      i = tag.end;
      continue;
    }
    if (tag.kind === "open") {
      if (stack.length === 0) topLevelOpener = tag;
      stack.push(tag);
      i = tag.end;
      continue;
    }
    // close
    const top = stack.pop();
    if (!top) {
      throw mismatchError(opts, tag, null, "closing tag has no matching opener");
    }
    if (top.name !== tag.name) {
      throw mismatchError(opts, tag, top, `expected </${top.name}> but found </${tag.name}>`);
    }
    if (stack.length === 0) {
      pairs.push({ opener: topLevelOpener!, closer: tag });
      topLevelOpener = null;
    }
    i = tag.end;
  }
  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]!;
    throw mismatchError(opts, null, unclosed, `<${unclosed.name}> is not closed before end of input`);
  }
  return pairs;
}

function mismatchError(
  opts: PreprocessOptions,
  bad: TagToken | null,
  context: TagToken | null,
  message: string
): Error {
  const file = opts.filename ?? "<input>";
  const where = bad ?? context;
  const at = where ? `${file}:${where.start}` : file;
  return new Error(`${at}: ${message}`);
}

/**
 * If `i` points at the start of a fenced code block, inline code span, or
 * HTML comment, return the position just past the end of that region. We
 * deliberately do not understand indented code blocks — those would require
 * line-start tracking the rest of the scanner doesn't currently do.
 */
function skipCodeOrComment(source: string, i: number): number {
  // HTML comment: `<!--` … `-->`
  if (source.startsWith("<!--", i)) {
    const end = source.indexOf("-->", i + 4);
    return end === -1 ? source.length : end + 3;
  }
  // Fenced code block: must start at column 0 (line-start). We check by
  // looking at the previous character — `\n` or i===0.
  const atLineStart = i === 0 || source[i - 1] === "\n";
  if (atLineStart) {
    if (source.startsWith("```", i) || source.startsWith("~~~", i)) {
      const fence = source[i]!;
      const fenceLen = countSameChar(source, i, fence);
      // Read the rest of the opening fence line; the closer must be a line
      // starting with at least the same number of fence chars.
      const lineEnd = source.indexOf("\n", i);
      const after = lineEnd === -1 ? source.length : lineEnd + 1;
      // Search for a closing fence at line-start.
      let j = after;
      while (j < source.length) {
        if (source[j] === fence && countSameChar(source, j, fence) >= fenceLen) {
          // Skip past the line that contains the closer.
          const k = source.indexOf("\n", j);
          return k === -1 ? source.length : k + 1;
        }
        const nl = source.indexOf("\n", j);
        j = nl === -1 ? source.length : nl + 1;
      }
      return source.length;
    }
  }
  // Inline code span: backtick run. We allow any-length backtick run; the
  // closer is a run of the same length.
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

function renderAttrs(attrs: TagAttr[]): string {
  if (attrs.length === 0) return "";
  const parts = attrs.map(a => {
    // remark-directive's attribute syntax: name="val" or name=val. Quote
    // values that contain whitespace, `"`, `}`, or `=`. The serializer escapes
    // embedded double quotes by HTML entities (cheap and round-trippable).
    if (a.value === "true" && a.valueStart === undefined) {
      // Boolean attr: emit just the name (remark-directive treats `name` as
      // `name=""`, but our resolver code accepts both — and `name="true"`
      // is the form the legacy directive parser already produced, so match
      // that to keep palette/lint behavior identical).
      return `${a.name}="true"`;
    }
    return `${a.name}="${a.value.replace(/"/g, "&quot;")}"`;
  });
  return `{${parts.join(" ")}}`;
}
