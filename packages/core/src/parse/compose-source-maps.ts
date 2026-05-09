/**
 * Source-map composition. Each preprocessor stage in the pipeline emits its
 * own SourceMapEntry[] relating its output positions back to its input
 * positions. To trace a final-output position all the way back to the
 * original content.md, we fold the stages' maps together.
 */

export interface SourceMapEntry {
  /** Offset in the final/composed output. */
  rewrittenStart: number;
  /** Offset in the original/composed input. */
  originalStart: number;
  /** Number of characters in this contiguous identity-mapped run. */
  length: number;
}

/**
 * Fold a chain of transformations' source maps into one map relating final
 * output positions back to original input positions.
 *
 * Each input map is the output of one transform: its `rewrittenStart` refers
 * to the offset in *that* transform's output, and `originalStart` refers to
 * its input (which is the previous transform's output).
 *
 * Composed map's `originalStart` refers to the very first input.
 *
 * Segments that cannot be traced back through every layer are dropped.
 */
export function composeSourceMaps(maps: SourceMapEntry[][]): SourceMapEntry[] {
  if (maps.length === 0) return [];
  if (maps.length === 1) return maps[0]!;
  let acc = maps[0]!;
  for (let i = 1; i < maps.length; i++) {
    acc = composePair(acc, maps[i]!);
  }
  return acc;
}

function composePair(m1: SourceMapEntry[], m2: SourceMapEntry[]): SourceMapEntry[] {
  // For each entry in m2 (output→stage-1-output), find an m1 entry that
  // covers its originalStart range and translate to m1's originalStart.
  const out: SourceMapEntry[] = [];
  for (const e2 of m2) {
    const e1 = m1.find(e =>
      e.rewrittenStart <= e2.originalStart &&
      e.rewrittenStart + e.length >= e2.originalStart + e2.length
    );
    if (!e1) continue; // segment isn't traceable through this layer
    const offsetInE1 = e2.originalStart - e1.rewrittenStart;
    out.push({
      rewrittenStart: e2.rewrittenStart,
      originalStart: e1.originalStart + offsetInE1,
      length: e2.length
    });
  }
  return out;
}
