/**
 * A region of the source that no normalizer should modify. Computed once per
 * cleanText() call and consulted by each rule. Boundaries are byte offsets.
 *
 * Skip rules cover the same regions preprocessTags skips:
 *   - Fenced code blocks (``` and ~~~ at column 0).
 *   - Inline code spans (`...`).
 *   - HTML comments (<!-- ... -->).
 *   - Tag openers/closers (<name attr="..."> and </name>).
 *   - Column-0 Tender markers (=== page, @@ slot, :::name, ::::page).
 */
export interface SkipRegion {
  start: number;
  end: number;
}

const TAG_RE = /<\/?[a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;
// Column-0 Tender markers: a whole line that's `=== page{...}`, `@@ name`,
// `:::name{...}`, `::::page{...}`, or a bare `:::` / `::::` closer line.
const COLUMN_0_MARKER_RE = /^(?:=== page(?:\{[^}]*\})?|@@ [\w-]+|:::[\w-]+(?:\{[^}]*\})?|::::page(?:\{[^}]*\})?|::::|:::)\s*$/gm;

export function computeSkipRegions(source: string): SkipRegion[] {
  const regions: SkipRegion[] = [];

  // 1. Fenced code blocks at column 0.
  let i = 0;
  while (i < source.length) {
    const atLineStart = i === 0 || source[i - 1] === "\n";
    if (atLineStart && (source.startsWith("```", i) || source.startsWith("~~~", i))) {
      const fence = source[i]!;
      const fenceLen = countSameChar(source, i, fence);
      const lineEnd = source.indexOf("\n", i);
      const after = lineEnd === -1 ? source.length : lineEnd + 1;
      let j = after;
      let end = source.length;
      while (j < source.length) {
        if (source[j] === fence && countSameChar(source, j, fence) >= fenceLen) {
          const k = source.indexOf("\n", j);
          end = k === -1 ? source.length : k + 1;
          break;
        }
        const nl = source.indexOf("\n", j);
        j = nl === -1 ? source.length : nl + 1;
      }
      regions.push({ start: i, end });
      i = end;
      continue;
    }
    i++;
  }

  // 2. Inline code spans.
  i = 0;
  while (i < source.length) {
    if (source[i] === "`" && !isInSkipRegion(i, regions)) {
      const len = countSameChar(source, i, "`");
      const closer = "`".repeat(len);
      const start = i + len;
      const end = source.indexOf(closer, start);
      if (end !== -1) {
        regions.push({ start: i, end: end + len });
        i = end + len;
        continue;
      }
    }
    i++;
  }

  // 3. HTML comments.
  i = 0;
  while ((i = source.indexOf("<!--", i)) !== -1) {
    if (isInSkipRegion(i, regions)) { i++; continue; }
    const close = source.indexOf("-->", i + 4);
    const end = close === -1 ? source.length : close + 3;
    regions.push({ start: i, end });
    i = end;
  }

  // 4. Tag openers/closers (regex respects quoted attribute values).
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(source))) {
    if (isInSkipRegion(m.index, regions)) continue;
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // 5. Column-0 markers.
  COLUMN_0_MARKER_RE.lastIndex = 0;
  while ((m = COLUMN_0_MARKER_RE.exec(source))) {
    if (isInSkipRegion(m.index, regions)) continue;
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Sort by start so isInSkipRegion's linear scan stays predictable.
  regions.sort((a, b) => a.start - b.start);
  return regions;
}

export function isInSkipRegion(offset: number, regions: SkipRegion[]): boolean {
  for (const r of regions) {
    if (offset >= r.start && offset < r.end) return true;
  }
  return false;
}

function countSameChar(source: string, i: number, ch: string): number {
  let n = 0;
  while (i + n < source.length && source[i + n] === ch) n++;
  return n;
}
