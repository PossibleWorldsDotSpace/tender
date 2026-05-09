/**
 * Rewrites registered single-character marks (e.g. `@speaker@`) into
 * closed-pair component tags (`<speaker-name>speaker</speaker-name>`).
 * Pure string→string with a source map; downstream pipeline unchanged.
 *
 * Constraints:
 *   - Same-line spans only (no multi-line shortcuts), matching CommonMark
 *     `*emphasis*`.
 *   - Backslash escapes (`\@`) pass through as literal `@`.
 *   - Empty spans (`@@` with no content between) pass through literal.
 *
 * Skip rules:
 *   - Fenced code blocks (``` and ~~~) at column 0.
 *   - Inline code spans (`...`).
 *   - HTML comments (<!-- ... -->).
 *   - Inside tag openers (<...>) — so `<row label="@x@">` keeps the @s
 *     inside the attribute value as literal characters.
 */

export interface SourceMapEntry {
  rewrittenStart: number;
  originalStart: number;
  length: number;
}

export interface PreprocessShortcutsResult {
  source: string;
  sourceMap: SourceMapEntry[];
}

export function preprocessInlineShortcuts(
  source: string,
  shortcuts: Record<string, string>
): PreprocessShortcutsResult {
  const sourceMap: SourceMapEntry[] = [];

  if (Object.keys(shortcuts).length === 0) {
    // Fast path: no shortcuts declared. Output equals input; one identity
    // source-map entry covers the whole thing.
    if (source.length > 0) {
      sourceMap.push({ rewrittenStart: 0, originalStart: 0, length: source.length });
    }
    return { source, sourceMap };
  }

  const shortcutChars = new Set(Object.keys(shortcuts));
  let out = "";
  let i = 0;

  // Track a literal-copy run so we can emit a single source-map entry for
  // each contiguous block of identity-mapped characters. `runStart` is the
  // original-source offset of the start; we flush before any non-identity
  // emission (rewriting a shortcut, escaping a backslash).
  let runStart = -1;

  function flushLiteralRun() {
    if (runStart === -1) return;
    const length = i - runStart;
    if (length > 0) {
      pushMap(sourceMap, out.length - length, runStart, length);
    }
    runStart = -1;
  }

  while (i < source.length) {
    // Skip code/comment/tag regions wholesale — copy them verbatim.
    const skipEnd = skipBoundary(source, i);
    if (skipEnd > i) {
      if (runStart === -1) runStart = i;
      out += source.slice(i, skipEnd);
      i = skipEnd;
      continue;
    }

    const ch = source[i]!;

    // Backslash escape: only consume the backslash when the next character
    // is a registered shortcut char. Otherwise the backslash is literal.
    if (ch === "\\" && i + 1 < source.length && shortcutChars.has(source[i + 1]!)) {
      flushLiteralRun();
      // Emit the next character only (skip the backslash). The shortcut
      // char in the rewritten output maps to the original shortcut char.
      out += source[i + 1]!;
      pushMap(sourceMap, out.length - 1, i + 1, 1);
      i += 2;
      continue;
    }

    if (shortcutChars.has(ch)) {
      const close = findClosingShortcut(source, i, ch);
      if (close !== -1 && close > i + 1) {
        // Found a same-line non-empty span: emit the wrapper.
        flushLiteralRun();
        const componentName = shortcuts[ch]!;
        const inner = source.slice(i + 1, close);
        out += `<${componentName}>`;
        // The inner text maps 1-1 back to its original offsets.
        pushMap(sourceMap, out.length, i + 1, inner.length);
        out += inner;
        out += `</${componentName}>`;
        i = close + 1;
        continue;
      }
      // Otherwise the character is literal; fall through to default copy.
    }

    if (runStart === -1) runStart = i;
    out += ch;
    i++;
  }

  flushLiteralRun();
  return { source: out, sourceMap };
}

/**
 * Find the offset just past a region we should pass through verbatim — a
 * fenced code block, an inline code span, an HTML comment, or a tag opener.
 * Returns the input position when none applies.
 */
function skipBoundary(source: string, i: number): number {
  // HTML comment.
  if (source.startsWith("<!--", i)) {
    const end = source.indexOf("-->", i + 4);
    return end === -1 ? source.length : end + 3;
  }
  // Fenced code block at line start.
  const atLineStart = i === 0 || source[i - 1] === "\n";
  if (atLineStart && (source.startsWith("```", i) || source.startsWith("~~~", i))) {
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
  // Inline code span: backtick run.
  if (source[i] === "`") {
    const len = countSameChar(source, i, "`");
    const closer = "`".repeat(len);
    const start = i + len;
    const end = source.indexOf(closer, start);
    return end === -1 ? i : end + len;
  }
  // HTML tag opener or closer: `<` followed by `/?[a-zA-Z]`. Scan forward to
  // `>` while respecting quoted attribute values. We're conservative: any
  // `<X...>` (X = letter) is treated as a tag and skipped.
  if (source[i] === "<") {
    const next = source[i + 1];
    const tagStartChar = next === "/" ? source[i + 2] : next;
    if (tagStartChar !== undefined && /[a-zA-Z]/.test(tagStartChar)) {
      let j = i + 1;
      while (j < source.length) {
        const c = source[j]!;
        if (c === '"' || c === "'") {
          // Skip the quoted region.
          const close = source.indexOf(c, j + 1);
          if (close === -1) return source.length;
          j = close + 1;
          continue;
        }
        if (c === ">") return j + 1;
        if (c === "\n") return i; // not a tag — line broke before `>`
        j++;
      }
      return source.length;
    }
  }
  return i;
}

function findClosingShortcut(source: string, openOffset: number, ch: string): number {
  // Walk forward on the same line. Skip backslash-escaped occurrences.
  // Returns -1 if not found.
  let j = openOffset + 1;
  while (j < source.length) {
    const c = source[j]!;
    if (c === "\n") return -1;
    if (c === "\\" && source[j + 1] === ch) {
      // Escaped occurrence of the shortcut char; skip it.
      j += 2;
      continue;
    }
    if (c === ch) return j;
    j++;
  }
  return -1;
}

function countSameChar(source: string, i: number, ch: string): number {
  let n = 0;
  while (i + n < source.length && source[i + n] === ch) n++;
  return n;
}

function pushMap(
  map: SourceMapEntry[],
  rewrittenStart: number,
  originalStart: number,
  length: number
) {
  if (length <= 0) return;
  const last = map[map.length - 1];
  if (last && last.rewrittenStart + last.length === rewrittenStart
           && last.originalStart + last.length === originalStart) {
    last.length += length;
    return;
  }
  map.push({ rewrittenStart, originalStart, length });
}
