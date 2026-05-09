/**
 * Rewrites column-0 `=== page` markers (with optional `{attrs}`) into matched
 * `<page>...</page>` tags. The output feeds `preprocessTags` as if the user
 * had authored explicit page tags directly; downstream resolution unchanged.
 *
 * Skip rules match preprocessTags:
 *   - Inside fenced code blocks (``` or ~~~ at column 0).
 *   - Inside HTML comments (<!-- ... -->).
 * A marker that appears inside an explicit <page> block is a usage error —
 * the inner marker would try to close the outer page.
 *
 * The trailing `page` keyword sidesteps a CommonMark setext H1 collision:
 * a heading line followed by `===` is an H1 underline; `=== page` is not.
 */

export interface SourceMapEntry {
  /** Offset in the rewritten output. */
  rewrittenStart: number;
  /** Offset in the original input. */
  originalStart: number;
  /** Number of characters this segment covers. */
  length: number;
}

export interface PreprocessPagesResult {
  source: string;
  sourceMap: SourceMapEntry[];
}

const MARKER_RE = /^=== page(?:\{([^}]*)\})?\s*$/;

export function preprocessPageBoundaries(source: string): PreprocessPagesResult {
  const sourceMap: SourceMapEntry[] = [];
  let out = "";
  let pageOpen = false;
  let explicitPageDepth = 0;

  // Pre-scan to find the byte offsets of skipped regions (fenced code, HTML
  // comments). We honor those when deciding whether a `=== page` line is a
  // marker.
  const skipped = computeSkippedRegions(source);

  // We process the source line-by-line because markers are line-anchored, but
  // we also need byte offsets for source maps and explicit-page tracking.
  const lines = splitLines(source);
  let lineByteStart = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const { text, terminator } = lines[lineIdx]!;
    const lineEnd = lineByteStart + text.length + terminator.length;

    const isInSkippedRegion = isOffsetInSkipped(lineByteStart, skipped);
    const m = !isInSkippedRegion ? MARKER_RE.exec(text) : null;

    if (m) {
      if (explicitPageDepth > 0) {
        throw new Error(
          `=== page marker cannot appear inside an explicit <page> block (line ${lineIdx + 1})`
        );
      }
      // Emit close-then-open: close any open page (implicit or explicit-from-marker),
      // then open a fresh page with the marker's attributes.
      const attrs = m[1] !== undefined ? renderAttrs(m[1]) : "";
      if (pageOpen) {
        out += "\n\n</page>\n\n";
      }
      out += `<page${attrs}>\n\n`;
      pageOpen = true;
      // Marker consumes its line; advance past the terminator and continue.
      lineByteStart = lineEnd;
      continue;
    }

    // Non-marker line. Track explicit <page> depth (rough scan; good enough
    // for the inside-explicit check).
    if (!isInSkippedRegion) {
      explicitPageDepth += countPageOpeners(text);
      explicitPageDepth -= countPageClosers(text);
      if (explicitPageDepth < 0) explicitPageDepth = 0; // tolerate malformed input
    }

    // Decide whether to start an implicit page when we encounter the first
    // non-empty non-marker content. Whitespace-only lines before any content
    // are passed through as literals but don't trigger the implicit wrap.
    if (!pageOpen && text.trim().length > 0) {
      out += "<page>\n\n";
      pageOpen = true;
    }

    // Copy the line (with terminator) verbatim and record a 1-1 source-map
    // entry over it.
    const copy = text + terminator;
    if (copy.length > 0) {
      pushMap(sourceMap, out.length, lineByteStart, copy.length);
      out += copy;
    }
    lineByteStart = lineEnd;
  }

  if (pageOpen) {
    out += "\n\n</page>\n\n";
  }

  return { source: out, sourceMap };
}

/**
 * Pre-scan: collect [start, end) ranges of the source that fenced code blocks
 * and HTML comments occupy. A `=== page` on a line whose start offset falls
 * inside one of these ranges is preserved as literal.
 */
interface SkippedRegion { start: number; end: number; }

function computeSkippedRegions(source: string): SkippedRegion[] {
  const out: SkippedRegion[] = [];
  let i = 0;
  while (i < source.length) {
    // HTML comment.
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      const end = close === -1 ? source.length : close + 3;
      out.push({ start: i, end });
      i = end;
      continue;
    }
    // Fenced code: ``` or ~~~ at line start.
    const atLineStart = i === 0 || source[i - 1] === "\n";
    if (atLineStart && (source.startsWith("```", i) || source.startsWith("~~~", i))) {
      const fence = source[i]!;
      const fenceLen = countSameChar(source, i, fence);
      const lineEnd = source.indexOf("\n", i);
      const after = lineEnd === -1 ? source.length : lineEnd + 1;
      // Find a closing fence at line-start.
      let j = after;
      let end = source.length;
      while (j < source.length) {
        const lineStart = j;
        if (source[j] === fence && countSameChar(source, j, fence) >= fenceLen) {
          const k = source.indexOf("\n", j);
          end = k === -1 ? source.length : k + 1;
          break;
        }
        const nl = source.indexOf("\n", lineStart);
        j = nl === -1 ? source.length : nl + 1;
      }
      out.push({ start: i, end });
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

function isOffsetInSkipped(offset: number, skipped: SkippedRegion[]): boolean {
  for (const r of skipped) {
    if (offset >= r.start && offset < r.end) return true;
  }
  return false;
}

function countSameChar(source: string, i: number, ch: string): number {
  let n = 0;
  while (i + n < source.length && source[i + n] === ch) n++;
  return n;
}

interface SplitLine { text: string; terminator: string; }

function splitLines(source: string): SplitLine[] {
  const out: SplitLine[] = [];
  let i = 0;
  while (i < source.length) {
    const nl = source.indexOf("\n", i);
    if (nl === -1) {
      out.push({ text: source.slice(i), terminator: "" });
      break;
    }
    out.push({ text: source.slice(i, nl), terminator: "\n" });
    i = nl + 1;
  }
  return out;
}

/**
 * Count `<page` opener tokens on a line. Conservative: matches `<page>`,
 * `<page ...>`, `<page/>`. Doesn't match strings inside quoted attribute
 * values; that's beyond what this preprocessor needs.
 */
function countPageOpeners(line: string): number {
  return (line.match(/<page(\s|>|\/)/g) ?? []).length;
}

function countPageClosers(line: string): number {
  return (line.match(/<\/page>/g) ?? []).length;
}

/**
 * Parse a marker's attribute spec and emit a quoted attribute string.
 * Accepts the same loose forms as tryParseTag — `template=cover`,
 * `template="cover"`, `template='cover'` — and re-quotes values for output.
 */
function renderAttrs(rawAttrs: string): string {
  const attrs = parseLooseAttrs(rawAttrs);
  if (attrs.length === 0) return "";
  const parts = attrs.map(a =>
    `${a.name}="${a.value.replace(/"/g, "&quot;")}"`
  );
  return ` ${parts.join(" ")}`;
}

interface LooseAttr { name: string; value: string; }

function parseLooseAttrs(s: string): LooseAttr[] {
  const out: LooseAttr[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    const nameStart = i;
    while (i < s.length && /[a-zA-Z][\w-]*/.test(s[i]!) && /[a-zA-Z0-9_-]/.test(s[i]!)) i++;
    if (i === nameStart) { i++; continue; }
    const name = s.slice(nameStart, i);
    if (s[i] !== "=") {
      out.push({ name, value: "true" });
      continue;
    }
    i++; // consume `=`
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i]!;
      const valueStart = i + 1;
      const close = s.indexOf(quote, valueStart);
      if (close === -1) {
        out.push({ name, value: s.slice(valueStart) });
        break;
      }
      out.push({ name, value: s.slice(valueStart, close) });
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < s.length && !/\s/.test(s[i]!)) i++;
      out.push({ name, value: s.slice(valueStart, i) });
    }
  }
  return out;
}

function pushMap(
  map: SourceMapEntry[],
  rewrittenStart: number,
  originalStart: number,
  length: number
) {
  if (length === 0) return;
  const last = map[map.length - 1];
  if (last && last.rewrittenStart + last.length === rewrittenStart
           && last.originalStart + last.length === originalStart) {
    last.length += length;
    return;
  }
  map.push({ rewrittenStart, originalStart, length });
}
