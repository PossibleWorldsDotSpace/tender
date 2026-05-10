# `tender clean` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land `tender clean`: a Markdown sanitiser that strips paste artifacts (BOM, zero-width characters, soft hyphens, NBSPs, mixed line endings, trailing whitespace, redundant blank lines) and optionally applies smart typography. Pure core, CLI wrapper with `--check`/`--yes`/`--typography` flags, project-config support.

**Architecture:** Eight character-level normalizers running in deterministic order through an orchestrator. Each normalizer is a small string→string function with a per-rule change count. Skip regions (fenced code, inline code, Tender component openers, column-0 markers) are computed once per run and respected by every rule. Lives in `@tender/core/clean/` alongside `lint/`; CLI in `packages/cli/src/commands/clean.ts`.

**Tech Stack:** TypeScript, vitest, `retext-smartypants` (new dep, used only by the typography rule), the existing `@tender/core` module conventions.

**Reference:** `docs/plans/2026-05-10-tender-clean-design.md`.

---

## Notes for the implementing engineer

- `pnpm -r build` rebuilds all packages. **You must rebuild `@tender/core` after every source change before CLI tests will see your changes** — the cross-package imports go through `dist/`. Failing to rebuild produces confusing test failures where unit tests pass but CLI tests fail.
- Conventional commits per CLAUDE.md (`feat(core): …`, `feat(cli): …`, `test(core): …`) with the `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer.
- Each task is one focused commit. TDD where useful (tests first, then implementation); for the trivial regex normalizers I group test + implementation in one commit — there's nothing to discover incrementally and the test serves as the spec.
- Skip-region helper logic is the trickiest piece. Most normalizers operate on text outside skip regions; the helper that decides "is this offset inside a code span / fenced block / tag opener / column-0 marker" is shared by all of them. Build it once, test it well, reuse.
- Tests for normalizers always include an idempotency assertion: run the normalizer twice, compare. Make this a test-helper to keep boilerplate low.
- `retext-smartypants` is the only new dependency. Verify it's idempotent before committing to it — the design doc claims it is, but check.

---

## Task 1: Report types and result shape

**Files:**
- Create: `packages/core/src/clean/types.ts`
- Create: `packages/core/src/clean/types.test.ts`

**Step 1: Define the result shape**

```ts
// packages/core/src/clean/types.ts

/** Codes for each rule, used in change summaries. Closed v1 union. */
export type CleanRuleCode =
  | "clean/bom"
  | "clean/line-endings"
  | "clean/zero-width"
  | "clean/soft-hyphens"
  | "clean/nbsp"
  | "clean/trailing-whitespace"
  | "clean/multiple-blank-lines"
  | "clean/typography";

/**
 * One rule's contribution to a clean run. `count` is the number of distinct
 * changes the rule made (e.g. characters stripped, lines trimmed). Zero
 * means the rule fired but found nothing to fix.
 */
export interface CleanRuleChange {
  code: CleanRuleCode;
  count: number;
  description: string;
}

/** Aggregate result of a `cleanText` run. */
export interface CleanResult {
  /** The cleaned source text. Equal to the input if no rule fired. */
  output: string;
  /** Per-rule changes, in run order. Rules with `count: 0` are omitted. */
  changes: CleanRuleChange[];
}

/** Options controlling which rules apply. */
export interface CleanOptions {
  /** Run rule 8 (typography). Default: false. */
  typography?: boolean;
}

/** Total number of changes across all rules. */
export function totalChanges(result: CleanResult): number {
  return result.changes.reduce((sum, c) => sum + c.count, 0);
}
```

**Step 2: Write the test**

```ts
// packages/core/src/clean/types.test.ts
import { describe, it, expect } from "vitest";
import type { CleanResult } from "./types.js";
import { totalChanges } from "./types.js";

describe("totalChanges", () => {
  it("sums change counts across rules", () => {
    const r: CleanResult = {
      output: "x",
      changes: [
        { code: "clean/bom", count: 1, description: "BOM removed" },
        { code: "clean/nbsp", count: 3, description: "3 NBSPs normalized" }
      ]
    };
    expect(totalChanges(r)).toBe(4);
  });

  it("returns zero for an empty changes array", () => {
    expect(totalChanges({ output: "", changes: [] })).toBe(0);
  });
});
```

**Step 3: Run + commit**

```
pnpm --filter @tender/core test -- --run src/clean/types.test.ts
```

Expected: PASS, 2 tests.

```
git add packages/core/src/clean/types.ts packages/core/src/clean/types.test.ts
git commit -m "$(cat <<'EOF'
feat(core): clean module types (tender clean step 1)

Adds CleanResult / CleanRuleChange / CleanOptions shapes plus a
totalChanges helper. Pins the closed v1 set of rule codes (8 rules,
all prefixed `clean/`).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Skip-region helper

**Files:**
- Create: `packages/core/src/clean/skip-regions.ts`
- Create: `packages/core/src/clean/skip-regions.test.ts`

**Step 1: Write the test fixture**

```ts
// packages/core/src/clean/skip-regions.test.ts
import { describe, it, expect } from "vitest";
import { computeSkipRegions, isInSkipRegion } from "./skip-regions.js";

describe("computeSkipRegions", () => {
  it("identifies fenced code blocks at line start", () => {
    const src = "Lead.\n\n```\ncode here\n```\n\nMore.";
    const regions = computeSkipRegions(src);
    // The fenced block from offset of the first ``` through the line
    // containing the closing ```.
    expect(regions.length).toBe(1);
    expect(src.slice(regions[0]!.start, regions[0]!.end)).toContain("code here");
  });

  it("identifies ~~~ fenced blocks", () => {
    const src = "~~~\nx\n~~~\n";
    const regions = computeSkipRegions(src);
    expect(regions.length).toBe(1);
  });

  it("identifies inline code spans", () => {
    const src = "Use `<row>` here.";
    const regions = computeSkipRegions(src);
    expect(regions.length).toBe(1);
    expect(src.slice(regions[0]!.start, regions[0]!.end)).toBe("`<row>`");
  });

  it("identifies HTML comments", () => {
    const src = "Before <!-- comment --> after.";
    const regions = computeSkipRegions(src);
    expect(regions.length).toBe(1);
    expect(src.slice(regions[0]!.start, regions[0]!.end)).toBe("<!-- comment -->");
  });

  it("identifies tag openers (preserving attribute values)", () => {
    const src = `<row label="45 minutes">body</row>`;
    const regions = computeSkipRegions(src);
    // Two regions: opener and closer.
    expect(regions.length).toBe(2);
    expect(src.slice(regions[0]!.start, regions[0]!.end)).toBe(`<row label="45 minutes">`);
    expect(src.slice(regions[1]!.start, regions[1]!.end)).toBe(`</row>`);
  });

  it("identifies column-0 page markers", () => {
    const src = "Lead.\n\n=== page\n\nBody.";
    const regions = computeSkipRegions(src);
    expect(regions.some(r => src.slice(r.start, r.end).includes("=== page"))).toBe(true);
  });

  it("identifies column-0 @@ slot markers", () => {
    const src = "<ad-lib>\n@@ suggested\nbody\n</ad-lib>";
    const regions = computeSkipRegions(src);
    expect(regions.some(r => src.slice(r.start, r.end).includes("@@ suggested"))).toBe(true);
  });

  it("returns empty for prose with no skip regions", () => {
    const regions = computeSkipRegions("Just plain prose here.");
    expect(regions).toEqual([]);
  });
});

describe("isInSkipRegion", () => {
  const regions = [
    { start: 0, end: 5 },
    { start: 10, end: 20 }
  ];

  it("returns true for offsets inside a region", () => {
    expect(isInSkipRegion(0, regions)).toBe(true);
    expect(isInSkipRegion(4, regions)).toBe(true);
    expect(isInSkipRegion(15, regions)).toBe(true);
  });

  it("returns false for offsets outside any region", () => {
    expect(isInSkipRegion(5, regions)).toBe(false);
    expect(isInSkipRegion(7, regions)).toBe(false);
    expect(isInSkipRegion(100, regions)).toBe(false);
  });
});
```

**Step 2: Verify tests fail**

```
pnpm --filter @tender/core test -- --run src/clean/skip-regions.test.ts
```

Expected: FAIL with "Cannot find module" — module doesn't exist yet.

**Step 3: Implement**

```ts
// packages/core/src/clean/skip-regions.ts

/**
 * A region of the source that no normalizer should modify. Computed once per
 * cleanText() call and consulted by each rule. Boundaries are byte offsets.
 *
 * Skip rules cover the same regions preprocessTags skips:
 *   - Fenced code blocks (``` and ~~~ at column 0).
 *   - Inline code spans (`...`).
 *   - HTML comments (<!-- ... -->).
 *   - Tag openers/closers (<name attr="..."> and </name>).
 *   - Column-0 Tender markers (=== page, @@ slot, :::name).
 */
export interface SkipRegion {
  start: number;
  end: number;
}

const TAG_OPENER_RE = /<\/?[a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;
const COLUMN_0_MARKER_RE = /^(?:=== page(?:\{[^}]*\})?|@@ [\w-]+|:::[\w-]+(?:\{[^}]*\})?|::::page(?:\{[^}]*\})?|::::|::::?\s*$|:::)\s*$/gm;

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

  // 4. Tag openers/closers (use a regex; respects quoted attribute values).
  TAG_OPENER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_OPENER_RE.exec(source))) {
    if (isInSkipRegion(m.index, regions)) continue;
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // 5. Column-0 markers.
  COLUMN_0_MARKER_RE.lastIndex = 0;
  while ((m = COLUMN_0_MARKER_RE.exec(source))) {
    if (isInSkipRegion(m.index, regions)) continue;
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Sort by start so isInSkipRegion's linear scan is predictable.
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
```

**Step 4: Run tests**

```
pnpm --filter @tender/core test -- --run src/clean/skip-regions.test.ts
```

Expected: PASS.

**Step 5: Commit**

```
git add packages/core/src/clean/skip-regions.ts packages/core/src/clean/skip-regions.test.ts
git commit -m "$(cat <<'EOF'
feat(core): clean skip-region helper (tender clean step 2)

Computes byte-offset ranges that no normalizer should modify:
fenced code blocks, inline code spans, HTML comments, tag openers/
closers, and column-0 Tender markers (=== page, @@ slot, :::name).

Built once per cleanText() call and consulted by each rule via
isInSkipRegion(offset, regions). Mirrors the skip rules used by
preprocessTags so the cleaner respects the same exclusions the
build pipeline does.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Idempotency test helper

**Files:**
- Create: `packages/core/src/clean/test-helpers.ts`

**Step 1: Implement**

This is a tiny helper that every normalizer's tests use. Bundle it as one file with no test of its own (it'll be exercised by every rule's tests).

```ts
// packages/core/src/clean/test-helpers.ts
import { expect } from "vitest";

/**
 * Assert that a normalizer is a fixed point: running it twice on the same
 * input produces byte-identical output to the first run. Every normalizer's
 * tests should call this to pin idempotency.
 *
 * Usage:
 *   const fn = (s: string) => normalizeBom(s).output;
 *   expectIdempotent(fn, source);
 */
export function expectIdempotent(
  fn: (s: string) => string,
  input: string
): void {
  const once = fn(input);
  const twice = fn(once);
  expect(twice).toBe(once);
}
```

**Step 2: Commit**

```
git add packages/core/src/clean/test-helpers.ts
git commit -m "$(cat <<'EOF'
feat(core): clean test-helpers — expectIdempotent (tender clean step 3)

Every normalizer's tests should call expectIdempotent() to pin the
fixed-point property: f(f(x)) == f(x). One assertion across all
rules keeps the boilerplate down.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rule 1 — BOM removal

**Files:**
- Create: `packages/core/src/clean/normalizers/bom.ts`
- Create: `packages/core/src/clean/normalizers/bom.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/normalizers/bom.test.ts
import { describe, it, expect } from "vitest";
import { normalizeBom } from "./bom.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeBom", () => {
  it("strips a leading BOM", () => {
    const r = normalizeBom("﻿hello");
    expect(r.output).toBe("hello");
    expect(r.change?.count).toBe(1);
  });

  it("does nothing when there's no BOM", () => {
    const r = normalizeBom("hello");
    expect(r.output).toBe("hello");
    expect(r.change).toBeNull();
  });

  it("does not strip a non-leading BOM", () => {
    // A BOM mid-text is technically a zero-width-non-breaking-space; the
    // zero-width rule handles it. BOM rule only strips leading.
    const r = normalizeBom("hello﻿world");
    expect(r.output).toBe("hello﻿world");
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeBom(s).output;
    expectIdempotent(fn, "﻿hello");
    expectIdempotent(fn, "no bom");
    expectIdempotent(fn, "");
  });
});
```

**Step 2: Verify tests fail**

```
pnpm --filter @tender/core test -- --run src/clean/normalizers/bom.test.ts
```

**Step 3: Implement**

```ts
// packages/core/src/clean/normalizers/bom.ts
import type { CleanRuleChange } from "../types.js";

export interface BomResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeBom(source: string): BomResult {
  if (!source.startsWith("﻿")) {
    return { output: source, change: null };
  }
  return {
    output: source.slice(1),
    change: { code: "clean/bom", count: 1, description: "BOM removed" }
  };
}
```

**Step 4: Run + commit**

```
pnpm --filter @tender/core test -- --run src/clean/normalizers/bom.test.ts
```

```
git add packages/core/src/clean/normalizers/bom.ts packages/core/src/clean/normalizers/bom.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rule 1 — BOM removal (tender clean step 4)

Strips a leading U+FEFF byte-order mark. Mid-text BOMs are left
alone — those are zero-width-non-breaking-space characters, handled
by the zero-width rule.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Rule 2 — Line endings

**Files:**
- Create: `packages/core/src/clean/normalizers/line-endings.ts`
- Create: `packages/core/src/clean/normalizers/line-endings.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/normalizers/line-endings.test.ts
import { describe, it, expect } from "vitest";
import { normalizeLineEndings } from "./line-endings.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeLineEndings", () => {
  it("converts CRLF to LF", () => {
    const r = normalizeLineEndings("a\r\nb\r\nc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change?.count).toBe(2);
  });

  it("converts lone CR (legacy Mac) to LF", () => {
    const r = normalizeLineEndings("a\rb\rc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change?.count).toBe(2);
  });

  it("handles mixed CRLF and CR in one file", () => {
    const r = normalizeLineEndings("a\r\nb\rc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change?.count).toBe(2);
  });

  it("does nothing for LF-only input", () => {
    const r = normalizeLineEndings("a\nb\nc");
    expect(r.output).toBe("a\nb\nc");
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeLineEndings(s).output;
    expectIdempotent(fn, "a\r\nb\rc");
    expectIdempotent(fn, "no changes");
  });
});
```

**Step 2: Verify tests fail; then implement**

```ts
// packages/core/src/clean/normalizers/line-endings.ts
import type { CleanRuleChange } from "../types.js";

export interface LineEndingsResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeLineEndings(source: string): LineEndingsResult {
  // Replace CRLF first to avoid double-counting (CR + LF would otherwise
  // be two changes for one logical line ending).
  let count = 0;
  let output = source.replace(/\r\n/g, () => { count++; return "\n"; });
  output = output.replace(/\r/g, () => { count++; return "\n"; });
  if (count === 0) return { output, change: null };
  return {
    output,
    change: {
      code: "clean/line-endings",
      count,
      description: `${count} line ending${count === 1 ? "" : "s"} normalized to LF`
    }
  };
}
```

**Step 3: Run + commit**

```
git add packages/core/src/clean/normalizers/line-endings.ts \
        packages/core/src/clean/normalizers/line-endings.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rule 2 — line ending normalization (tender clean step 5)

Converts CRLF and lone CR to LF. CRLF replacement runs first so a
Windows-style line counts as one change rather than two.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rule 3 — Zero-width characters

**Files:**
- Create: `packages/core/src/clean/normalizers/zero-width.ts`
- Create: `packages/core/src/clean/normalizers/zero-width.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/normalizers/zero-width.test.ts
import { describe, it, expect } from "vitest";
import { normalizeZeroWidth } from "./zero-width.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeZeroWidth", () => {
  it("strips zero-width space (U+200B)", () => {
    const r = normalizeZeroWidth("a​b", computeSkipRegions("a​b"));
    expect(r.output).toBe("ab");
    expect(r.change?.count).toBe(1);
  });

  it("strips zero-width non-joiner (U+200C)", () => {
    const r = normalizeZeroWidth("a‌b", computeSkipRegions("a‌b"));
    expect(r.output).toBe("ab");
  });

  it("strips zero-width joiner (U+200D)", () => {
    const r = normalizeZeroWidth("a‍b", computeSkipRegions("a‍b"));
    expect(r.output).toBe("ab");
  });

  it("strips word joiner (U+2060)", () => {
    const r = normalizeZeroWidth("a⁠b", computeSkipRegions("a⁠b"));
    expect(r.output).toBe("ab");
  });

  it("strips multiple zero-width chars at once", () => {
    const src = "a​‌‍b";
    const r = normalizeZeroWidth(src, computeSkipRegions(src));
    expect(r.output).toBe("ab");
    expect(r.change?.count).toBe(3);
  });

  it("preserves zero-width chars inside a fenced code block", () => {
    const src = "before\n\n```\nzero​width\n```\n\nafter";
    const regions = computeSkipRegions(src);
    const r = normalizeZeroWidth(src, regions);
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("preserves zero-width chars inside an inline code span", () => {
    const src = "use `zero​width` here";
    const r = normalizeZeroWidth(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("returns null change when there's nothing to strip", () => {
    const r = normalizeZeroWidth("plain prose", computeSkipRegions("plain prose"));
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const src = "a​b‌c";
    const fn = (s: string) => normalizeZeroWidth(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, src);
    expectIdempotent(fn, "no changes");
  });
});
```

**Step 2: Implement**

```ts
// packages/core/src/clean/normalizers/zero-width.ts
import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

const ZERO_WIDTH = new Set(["​", "‌", "‍", "⁠"]);

export interface ZeroWidthResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeZeroWidth(
  source: string,
  skip: SkipRegion[]
): ZeroWidthResult {
  let out = "";
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ZERO_WIDTH.has(ch) && !isInSkipRegion(i, skip)) {
      count++;
      continue;
    }
    out += ch;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/zero-width",
      count,
      description: `${count} zero-width character${count === 1 ? "" : "s"} removed`
    }
  };
}
```

**Step 3: Run + commit**

```
git add packages/core/src/clean/normalizers/zero-width.ts \
        packages/core/src/clean/normalizers/zero-width.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rule 3 — zero-width character removal (tender clean step 6)

Strips U+200B (zero-width space), U+200C (zero-width non-joiner),
U+200D (zero-width joiner), and U+2060 (word joiner). These are
common Word/Docs paste artifacts. Skip regions (fenced code, inline
code, tag openers, column-0 markers) are preserved verbatim.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rule 4 — Soft hyphens

**Files:**
- Create: `packages/core/src/clean/normalizers/soft-hyphens.ts`
- Create: `packages/core/src/clean/normalizers/soft-hyphens.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/normalizers/soft-hyphens.test.ts
import { describe, it, expect } from "vitest";
import { normalizeSoftHyphens } from "./soft-hyphens.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeSoftHyphens", () => {
  it("strips soft hyphens", () => {
    const src = "im­por­tant";
    const r = normalizeSoftHyphens(src, computeSkipRegions(src));
    expect(r.output).toBe("important");
    expect(r.change?.count).toBe(2);
  });

  it("preserves soft hyphens inside a fenced code block", () => {
    const src = "before\n\n```\nim­portant\n```\n\nafter";
    const r = normalizeSoftHyphens(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("returns null change when there's nothing to strip", () => {
    const r = normalizeSoftHyphens("plain prose", computeSkipRegions("plain prose"));
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeSoftHyphens(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, "im­por­tant");
    expectIdempotent(fn, "no changes");
  });
});
```

**Step 2: Implement**

```ts
// packages/core/src/clean/normalizers/soft-hyphens.ts
import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

const SOFT_HYPHEN = "­";

export interface SoftHyphensResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeSoftHyphens(
  source: string,
  skip: SkipRegion[]
): SoftHyphensResult {
  let out = "";
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === SOFT_HYPHEN && !isInSkipRegion(i, skip)) {
      count++;
      continue;
    }
    out += ch;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/soft-hyphens",
      count,
      description: `${count} soft hyphen${count === 1 ? "" : "s"} removed`
    }
  };
}
```

**Step 3: Run + commit**

```
git add packages/core/src/clean/normalizers/soft-hyphens.ts \
        packages/core/src/clean/normalizers/soft-hyphens.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rule 4 — soft hyphen removal (tender clean step 7)

Strips U+00AD soft hyphens, which Word and Docs sometimes embed for
in-source line-break hints. Tender uses CSS hyphenation; source-level
soft hyphens are noise. Skip regions preserve them inside code blocks
in case the user pasted code that legitimately contains them.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Rule 5 — NBSP normalization

**Files:**
- Create: `packages/core/src/clean/normalizers/nbsp.ts`
- Create: `packages/core/src/clean/normalizers/nbsp.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/normalizers/nbsp.test.ts
import { describe, it, expect } from "vitest";
import { normalizeNbsp } from "./nbsp.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeNbsp", () => {
  it("converts NBSP to a regular space", () => {
    const src = "45 minutes";
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe("45 minutes");
    expect(r.change?.count).toBe(1);
  });

  it("preserves NBSP inside a tag attribute value", () => {
    const src = `<row label="45 minutes">body</row>`;
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("preserves NBSP inside a fenced code block", () => {
    const src = "```\nfn( arg)\n```";
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("preserves NBSP inside an inline code span", () => {
    const src = "use `45 minutes` here";
    const r = normalizeNbsp(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("returns null change when there are no NBSPs to convert", () => {
    const r = normalizeNbsp("plain prose", computeSkipRegions("plain prose"));
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeNbsp(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, "45 minutes");
    expectIdempotent(fn, "plain prose");
  });
});
```

**Step 2: Implement**

```ts
// packages/core/src/clean/normalizers/nbsp.ts
import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

const NBSP = " ";

export interface NbspResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeNbsp(
  source: string,
  skip: SkipRegion[]
): NbspResult {
  let out = "";
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === NBSP && !isInSkipRegion(i, skip)) {
      out += " ";
      count++;
      continue;
    }
    out += ch;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/nbsp",
      count,
      description: `${count} NBSP${count === 1 ? "" : "s"} normalized to space`
    }
  };
}
```

**Step 3: Run + commit**

```
git add packages/core/src/clean/normalizers/nbsp.ts \
        packages/core/src/clean/normalizers/nbsp.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rule 5 — NBSP normalization (tender clean step 8)

Converts U+00A0 (non-breaking space) to a regular space. Word and
Docs paste typically embeds NBSP between numerals and units (e.g.
"45[NBSP]minutes"). CSS handles non-breaking in print; source-level
NBSPs are noise. Skip regions preserve them inside code (where they
might be intentional) and inside tag attribute values (where the
build pipeline treats them as legitimate value characters).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Rule 6 — Trailing whitespace

**Files:**
- Create: `packages/core/src/clean/normalizers/trailing-whitespace.ts`
- Create: `packages/core/src/clean/normalizers/trailing-whitespace.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/normalizers/trailing-whitespace.test.ts
import { describe, it, expect } from "vitest";
import { normalizeTrailingWhitespace } from "./trailing-whitespace.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeTrailingWhitespace", () => {
  it("strips trailing spaces from lines", () => {
    const r = normalizeTrailingWhitespace("hello   \nworld   ");
    expect(r.output).toBe("hello\nworld");
    expect(r.change?.count).toBe(2);
  });

  it("strips trailing tabs", () => {
    const r = normalizeTrailingWhitespace("hello\t\t\nworld");
    expect(r.output).toBe("hello\nworld");
  });

  it("preserves trailing two spaces (Markdown hard break)", () => {
    const r = normalizeTrailingWhitespace("hello  \nworld");
    expect(r.output).toBe("hello  \nworld");
    expect(r.change).toBeNull();
  });

  it("does not preserve trailing one space (not a hard break)", () => {
    const r = normalizeTrailingWhitespace("hello \nworld");
    expect(r.output).toBe("hello\nworld");
    expect(r.change?.count).toBe(1);
  });

  it("does not preserve trailing three spaces (not a hard break)", () => {
    const r = normalizeTrailingWhitespace("hello   \nworld");
    expect(r.output).toBe("hello\nworld");
  });

  it("does not preserve trailing tab + space (not a hard break)", () => {
    const r = normalizeTrailingWhitespace("hello\t \nworld");
    expect(r.output).toBe("hello\nworld");
  });

  it("does not strip trailing whitespace from a blank line (already empty)", () => {
    // A line that's just spaces becomes empty.
    const r = normalizeTrailingWhitespace("hello\n   \nworld");
    expect(r.output).toBe("hello\n\nworld");
    expect(r.change?.count).toBe(1);
  });

  it("returns null change when there's nothing to trim", () => {
    const r = normalizeTrailingWhitespace("hello\nworld");
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeTrailingWhitespace(s).output;
    expectIdempotent(fn, "hello   \nworld   ");
    expectIdempotent(fn, "hello  \nworld");
    expectIdempotent(fn, "no changes");
  });
});
```

**Step 2: Implement**

```ts
// packages/core/src/clean/normalizers/trailing-whitespace.ts
import type { CleanRuleChange } from "../types.js";

export interface TrailingWhitespaceResult {
  output: string;
  change: CleanRuleChange | null;
}

export function normalizeTrailingWhitespace(source: string): TrailingWhitespaceResult {
  const lines = source.split("\n");
  let count = 0;
  const out = lines.map(line => {
    // Preserve a trailing exactly-two-ASCII-spaces sequence (Markdown hard
    // break). Anything else trailing whitespace gets trimmed.
    if (/^.*\S {2}$/.test(line)) return line;
    const trimmed = line.replace(/[ \t]+$/, "");
    if (trimmed !== line) count++;
    return trimmed;
  });
  if (count === 0) return { output: source, change: null };
  return {
    output: out.join("\n"),
    change: {
      code: "clean/trailing-whitespace",
      count,
      description: `${count} line${count === 1 ? "" : "s"} trimmed of trailing whitespace`
    }
  };
}
```

**Step 3: Run + commit**

```
git add packages/core/src/clean/normalizers/trailing-whitespace.ts \
        packages/core/src/clean/normalizers/trailing-whitespace.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rule 6 — trailing whitespace (tender clean step 9)

Trims trailing spaces and tabs from each line. Preserves a trailing
exactly-two-ASCII-spaces sequence on non-blank lines (Markdown's hard-
break syntax). Anything else — single trailing space, three or more,
or a mix of spaces and tabs — gets trimmed.

This rule operates line-by-line on raw text (no skip-region
awareness needed): trailing whitespace inside fenced code or tag
attributes can't exist by definition, since those regions don't
end at a line break.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Rule 7 — Multiple blank lines

**Files:**
- Create: `packages/core/src/clean/normalizers/multiple-blank-lines.ts`
- Create: `packages/core/src/clean/normalizers/multiple-blank-lines.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/normalizers/multiple-blank-lines.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMultipleBlankLines } from "./multiple-blank-lines.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeMultipleBlankLines", () => {
  it("collapses 3+ blank lines to 2", () => {
    const src = "a\n\n\n\nb";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe("a\n\n\nb"); // a + blank + blank + b → 2 blank lines between
    // Wait: split on \n gives ["a", "", "", "", "b"]. We want to collapse to
    // ["a", "", "", "b"] (3 newlines, 2 blanks).
    expect(r.change?.count).toBe(1);
  });

  it("preserves exactly 2 blank lines", () => {
    const src = "a\n\n\nb"; // a, blank, blank, b → 2 blank lines.
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("preserves 1 blank line", () => {
    const src = "a\n\nb";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("preserves blank-line runs inside fenced code", () => {
    const src = "before\n\n```\na\n\n\n\nb\n```\n\nafter";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("counts each collapsed run as one change", () => {
    const src = "a\n\n\n\nb\n\n\n\nc";
    const r = normalizeMultipleBlankLines(src, computeSkipRegions(src));
    expect(r.change?.count).toBe(2); // two runs collapsed
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeMultipleBlankLines(s, computeSkipRegions(s)).output;
    expectIdempotent(fn, "a\n\n\n\nb");
    expectIdempotent(fn, "a\n\n\nb");
  });
});
```

**Step 2: Implement**

```ts
// packages/core/src/clean/normalizers/multiple-blank-lines.ts
import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";
import { isInSkipRegion } from "../skip-regions.js";

export interface MultipleBlankLinesResult {
  output: string;
  change: CleanRuleChange | null;
}

/**
 * Collapse runs of 3+ consecutive blank lines (i.e., 4+ consecutive
 * newlines) down to 2 blank lines (3 newlines). Skip regions are
 * preserved verbatim.
 *
 * "Blank line" means a `\n` immediately followed by `\n`. Whitespace-only
 * lines should already be empty by the time this runs (rule 6 trimmed
 * them).
 */
export function normalizeMultipleBlankLines(
  source: string,
  skip: SkipRegion[]
): MultipleBlankLinesResult {
  let out = "";
  let i = 0;
  let count = 0;
  while (i < source.length) {
    if (isInSkipRegion(i, skip)) {
      // Find the end of the skip region containing i, copy verbatim.
      const region = skip.find(r => r.start <= i && i < r.end)!;
      out += source.slice(region.start, region.end);
      i = region.end;
      continue;
    }
    // Detect a run of consecutive newlines starting at i.
    if (source[i] === "\n") {
      let runEnd = i;
      while (runEnd < source.length && source[runEnd] === "\n") runEnd++;
      const runLen = runEnd - i;
      // 4+ newlines = 3+ blank lines. Collapse to 3 newlines (2 blank lines).
      if (runLen > 3) {
        out += "\n\n\n";
        count++;
      } else {
        out += source.slice(i, runEnd);
      }
      i = runEnd;
      continue;
    }
    out += source[i]!;
    i++;
  }
  if (count === 0) return { output: source, change: null };
  return {
    output: out,
    change: {
      code: "clean/multiple-blank-lines",
      count,
      description: `${count} blank-line run${count === 1 ? "" : "s"} collapsed`
    }
  };
}
```

**Step 3: Run + commit**

```
git add packages/core/src/clean/normalizers/multiple-blank-lines.ts \
        packages/core/src/clean/normalizers/multiple-blank-lines.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rule 7 — multiple blank lines (tender clean step 10)

Collapse runs of 3+ blank lines (4+ newlines) down to 2 blank lines
(3 newlines). Markdown only needs one blank between blocks; two is
a stylistic max for visual section breaks. Skip regions inside
fenced code preserve any blank-line runs verbatim.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Rule 8 — Typography (opt-in)

**Files:**
- Modify: `packages/core/package.json` (add `retext-smartypants` dependency)
- Create: `packages/core/src/clean/normalizers/typography.ts`
- Create: `packages/core/src/clean/normalizers/typography.test.ts`

**Step 1: Add the dependency**

```
pnpm --filter @tender/core add retext retext-smartypants retext-stringify
```

Note: we use the `unified`+`retext` ecosystem because that's idiomatic for these plugins. `retext-smartypants` operates on a retext AST (text-only); we feed it the source as a single text node, run the plugin, and stringify back.

**Step 2: Write the test**

```ts
// packages/core/src/clean/normalizers/typography.test.ts
import { describe, it, expect } from "vitest";
import { normalizeTypography } from "./typography.js";
import { computeSkipRegions } from "../skip-regions.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeTypography", () => {
  it("converts straight double quotes around words to curly", async () => {
    const src = `She said "hello".`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(`She said “hello”.`);
    expect(r.change?.count).toBeGreaterThan(0);
  });

  it("converts straight single quotes (apostrophes) to curly", async () => {
    const src = `it's a test`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(`it’s a test`);
  });

  it("converts -- to em-dash", async () => {
    const src = `wait -- pause`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("—");
  });

  it("converts ... to ellipsis", async () => {
    const src = `pause...`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toContain("…");
  });

  it("preserves typography characters that already curly", async () => {
    const src = `“hello”`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
    expect(r.change).toBeNull();
  });

  it("does not touch quotes inside fenced code blocks", async () => {
    const src = "```\n\"hello\"\n```";
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("does not touch quotes inside inline code spans", async () => {
    const src = "use `\"hello\"` literally";
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("does not touch quotes inside tag attribute values", async () => {
    const src = `<row label="45 minutes">body</row>`;
    const r = await normalizeTypography(src, computeSkipRegions(src));
    expect(r.output).toBe(src);
  });

  it("is idempotent", async () => {
    const src = `She said "hello" -- it's good...`;
    const once = (await normalizeTypography(src, computeSkipRegions(src))).output;
    const twice = (await normalizeTypography(once, computeSkipRegions(once))).output;
    expect(twice).toBe(once);
  });
});
```

**Step 3: Implement**

```ts
// packages/core/src/clean/normalizers/typography.ts
import { unified } from "unified";
import retextEnglish from "retext-english";
import retextSmartypants from "retext-smartypants";
import retextStringify from "retext-stringify";
import type { CleanRuleChange } from "../types.js";
import type { SkipRegion } from "../skip-regions.js";

export interface TypographyResult {
  output: string;
  change: CleanRuleChange | null;
}

/**
 * Apply smart-typography conversions (curly quotes, em/en-dashes, ellipsis)
 * to the parts of the source that are not in a skip region. Each segment
 * outside skip regions is processed independently; skip regions are spliced
 * back verbatim.
 *
 * Powered by retext-smartypants. Idempotent by spec — running twice on the
 * same input produces the same output.
 */
export async function normalizeTypography(
  source: string,
  skip: SkipRegion[]
): Promise<TypographyResult> {
  // Build segments: alternating non-skip and skip slices.
  const sortedSkip = [...skip].sort((a, b) => a.start - b.start);
  const segments: { text: string; skip: boolean }[] = [];
  let cursor = 0;
  for (const r of sortedSkip) {
    if (r.start > cursor) {
      segments.push({ text: source.slice(cursor, r.start), skip: false });
    }
    segments.push({ text: source.slice(r.start, r.end), skip: true });
    cursor = r.end;
  }
  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), skip: false });
  }

  const processor = unified()
    .use(retextEnglish)
    .use(retextSmartypants)
    .use(retextStringify);

  let out = "";
  let originalNonSkip = "";
  for (const seg of segments) {
    if (seg.skip) {
      out += seg.text;
    } else {
      originalNonSkip += seg.text;
      const file = await processor.process(seg.text);
      out += String(file);
    }
  }

  if (out === source) {
    return { output: out, change: null };
  }
  // Approximate change count: number of differing characters between the
  // original non-skip text and the processed non-skip text. We don't run
  // a fancy diff — an integer count is sufficient for the change summary.
  let count = 0;
  let processedNonSkip = "";
  for (const seg of segments) {
    if (!seg.skip) {
      const file = await processor.process(seg.text);
      processedNonSkip += String(file);
    }
  }
  const minLen = Math.min(originalNonSkip.length, processedNonSkip.length);
  for (let i = 0; i < minLen; i++) {
    if (originalNonSkip[i] !== processedNonSkip[i]) count++;
  }
  count += Math.abs(originalNonSkip.length - processedNonSkip.length);
  return {
    output: out,
    change: {
      code: "clean/typography",
      count,
      description: `${count} typography character${count === 1 ? "" : "s"} normalized`
    }
  };
}
```

**Step 4: Run + commit**

```
pnpm --filter @tender/core test -- --run src/clean/normalizers/typography.test.ts
```

```
git add packages/core/package.json packages/core/src/clean/normalizers/typography.ts packages/core/src/clean/normalizers/typography.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(core): rule 8 — typography (tender clean step 11)

Opt-in smart-typography via retext-smartypants: straight quotes →
curly, -- → em-dash, ... → ellipsis. Skip regions (fenced code,
inline code, tag openers) are spliced back verbatim, so the rule
never touches quotes inside `code spans`, attribute values, or
fenced blocks.

retext-smartypants is idempotent by spec — running twice on the
same input produces the same output.

Adds retext + retext-english + retext-smartypants + retext-stringify
as @tender/core deps.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Schema — `clean.typography` config

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`

**Step 1: Add the schema**

In `schema.ts`, add a `Clean` section before `ProjectConfig`:

```ts
export const Clean = z.object({
  /** Enable rule 8 (smart-typography). Default: off. */
  typography: z.enum(["off", "smart"]).optional()
});
```

Then add it to `ProjectConfig`:

```ts
export const ProjectConfig = z.object({
  // ... existing fields ...
  clean: Clean.optional(),
});
```

**Step 2: Add tests**

```ts
// In packages/core/src/config/schema.test.ts, add:

it("accepts a clean.typography setting", () => {
  const c = ProjectConfig.parse({
    "page-templates": { default: { size: "A5", margin: 0 } },
    clean: { typography: "smart" }
  });
  expect(c.clean?.typography).toBe("smart");
});

it("accepts clean: {} as the no-op default", () => {
  const c = ProjectConfig.parse({
    "page-templates": { default: { size: "A5", margin: 0 } },
    clean: {}
  });
  expect(c.clean?.typography).toBeUndefined();
});

it("rejects unknown values for clean.typography", () => {
  expect(() =>
    ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      clean: { typography: "yes" }
    })
  ).toThrow();
});
```

**Step 3: Run + commit**

```
pnpm --filter @tender/core test -- --run src/config/schema.test.ts
```

```
git add packages/core/src/config/schema.ts packages/core/src/config/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(core): clean.typography project-config field (tender clean step 12)

Adds an optional top-level `clean:` block to ProjectConfig with one
field: `typography: off | smart`. When present and set to "smart",
tender clean behaves as if --typography were passed.

Schema designed as an object (not a boolean) so future fields
(preserve-trailing-double-space, dash-style, quote-direction) can
land without breaking compatibility.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Orchestrator — `cleanText`

**Files:**
- Create: `packages/core/src/clean/index.ts`
- Create: `packages/core/src/clean/index.test.ts`

**Step 1: Write the test**

```ts
// packages/core/src/clean/index.test.ts
import { describe, it, expect } from "vitest";
import { cleanText } from "./index.js";

describe("cleanText", () => {
  it("returns input unchanged when no rules fire", async () => {
    const r = await cleanText("plain prose\n");
    expect(r.output).toBe("plain prose\n");
    expect(r.changes).toEqual([]);
  });

  it("applies all default-on rules in order", async () => {
    const src = "﻿hello​ world \r\nmore   \nx­y";
    const r = await cleanText(src);
    expect(r.output).not.toContain("﻿");
    expect(r.output).not.toContain("​");
    expect(r.output).not.toContain(" ");
    expect(r.output).not.toContain("\r");
    expect(r.output).not.toContain("   \n"); // trailing whitespace stripped
    expect(r.output).not.toContain("­");
  });

  it("does not run typography when option is off", async () => {
    const src = `She said "hello".`;
    const r = await cleanText(src, { typography: false });
    expect(r.output).toBe(src);
    expect(r.changes.find(c => c.code === "clean/typography")).toBeUndefined();
  });

  it("runs typography when option is true", async () => {
    const src = `She said "hello".`;
    const r = await cleanText(src, { typography: true });
    expect(r.output).toContain("“");
  });

  it("returns one change entry per rule that fired", async () => {
    const src = "﻿hello​ world";
    const r = await cleanText(src);
    expect(r.changes.map(c => c.code).sort()).toEqual(
      ["clean/bom", "clean/zero-width"]
    );
  });

  it("is idempotent — running twice produces the same output", async () => {
    const src = "﻿hello \"world\"  \r\nmore";
    const once = (await cleanText(src, { typography: true })).output;
    const twice = (await cleanText(once, { typography: true })).output;
    expect(twice).toBe(once);
  });

  it("kitchen-sink Word-paste fixture", async () => {
    const src = "﻿She said \"hello\"​--\r\nshe paused­.   \nNext line.";
    const r = await cleanText(src, { typography: true });
    // No paste artifacts in the output.
    expect(r.output).not.toMatch(/[﻿​ ­\r]/);
    expect(r.output).not.toMatch(/   $/m); // no trailing 3-spaces
    // Smart typography applied.
    expect(r.output).toContain("“");
    expect(r.output).toContain("—");
  });
});
```

**Step 2: Implement**

```ts
// packages/core/src/clean/index.ts
import type { CleanOptions, CleanResult, CleanRuleChange } from "./types.js";
import { computeSkipRegions } from "./skip-regions.js";
import { normalizeBom } from "./normalizers/bom.js";
import { normalizeLineEndings } from "./normalizers/line-endings.js";
import { normalizeZeroWidth } from "./normalizers/zero-width.js";
import { normalizeSoftHyphens } from "./normalizers/soft-hyphens.js";
import { normalizeNbsp } from "./normalizers/nbsp.js";
import { normalizeTrailingWhitespace } from "./normalizers/trailing-whitespace.js";
import { normalizeMultipleBlankLines } from "./normalizers/multiple-blank-lines.js";
import { normalizeTypography } from "./normalizers/typography.js";

export type { CleanOptions, CleanResult, CleanRuleChange, CleanRuleCode } from "./types.js";
export { totalChanges } from "./types.js";

/**
 * Apply the v1 clean pipeline: 7 default-on character/whitespace rules plus
 * one opt-in typography rule. Each rule's contribution is appended to the
 * `changes` list (rules with zero changes are omitted).
 *
 * Skip regions (fenced code, inline code, tag openers, column-0 markers)
 * are computed once on the input and refreshed only when a rule's change
 * meaningfully invalidates them — in practice, after BOM removal and line-
 * ending normalization, since those can shift offsets. Subsequent rules
 * recompute skip regions on the latest output.
 */
export async function cleanText(
  source: string,
  opts: CleanOptions = {}
): Promise<CleanResult> {
  const changes: CleanRuleChange[] = [];
  let s = source;

  // 1. BOM (offsets shift if BOM was present; skip regions invalidated).
  const bom = normalizeBom(s);
  if (bom.change) changes.push(bom.change);
  s = bom.output;

  // 2. Line endings.
  const le = normalizeLineEndings(s);
  if (le.change) changes.push(le.change);
  s = le.output;

  // From here on, recompute skip regions for each rule. This is O(n) per
  // rule but n is small for content.md — even a 60-page manuscript is
  // ~100KB. Avoid premature optimization.
  let skip = computeSkipRegions(s);

  // 3. Zero-width.
  const zw = normalizeZeroWidth(s, skip);
  if (zw.change) changes.push(zw.change);
  s = zw.output;
  if (zw.change) skip = computeSkipRegions(s);

  // 4. Soft hyphens.
  const sh = normalizeSoftHyphens(s, skip);
  if (sh.change) changes.push(sh.change);
  s = sh.output;
  if (sh.change) skip = computeSkipRegions(s);

  // 5. NBSP.
  const nb = normalizeNbsp(s, skip);
  if (nb.change) changes.push(nb.change);
  s = nb.output;
  if (nb.change) skip = computeSkipRegions(s);

  // 6. Trailing whitespace (line-by-line; no skip awareness needed).
  const tw = normalizeTrailingWhitespace(s);
  if (tw.change) changes.push(tw.change);
  s = tw.output;
  skip = computeSkipRegions(s);

  // 7. Multiple blank lines.
  const mbl = normalizeMultipleBlankLines(s, skip);
  if (mbl.change) changes.push(mbl.change);
  s = mbl.output;

  // 8. Typography (opt-in).
  if (opts.typography) {
    skip = computeSkipRegions(s);
    const ty = await normalizeTypography(s, skip);
    if (ty.change) changes.push(ty.change);
    s = ty.output;
  }

  return { output: s, changes };
}
```

**Step 3: Run + commit**

```
pnpm --filter @tender/core test -- --run src/clean/index.test.ts
```

```
git add packages/core/src/clean/index.ts packages/core/src/clean/index.test.ts
git commit -m "$(cat <<'EOF'
feat(core): cleanText orchestrator (tender clean step 13)

Runs the eight rules in fixed order, threading skip regions through
the pipeline (recomputed after each rule whose changes shifted
offsets). Typography (rule 8) is gated by opts.typography and is the
only rule with async work — the others are pure synchronous string
transforms.

Each rule's contribution to the output appears in `changes` with a
non-zero count; rules that fired but found nothing to fix are
omitted from the list.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Export from `@tender/core`

**Files:**
- Modify: `packages/core/src/index.ts`

**Step 1: Add exports**

```ts
// Append to packages/core/src/index.ts:
export { cleanText, totalChanges } from "./clean/index.js";
export type { CleanResult, CleanRuleChange, CleanRuleCode, CleanOptions } from "./clean/index.js";
```

**Step 2: Build + commit**

```
pnpm --filter @tender/core build
```

```
git add packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): export cleanText from @tender/core (tender clean step 14)

Surfaces cleanText, totalChanges, and the CleanResult/CleanOptions
types. Consumed by @tender/cli's tender clean command in the next
task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: CLI command — `tender clean`

**Files:**
- Create: `packages/cli/src/commands/clean.ts`
- Create: `packages/cli/src/commands/clean.test.ts`
- Modify: `packages/cli/src/cli.ts`

**Step 1: Implement the command logic**

```ts
// packages/cli/src/commands/clean.ts
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { cleanText, totalChanges } from "@tender/core";
import { loadProjectConfig } from "@tender/core";
import type { CleanResult } from "@tender/core";

export interface CleanCliOptions {
  /** --check: don't write; exit 1 if changes pending. */
  check?: boolean;
  /** --yes: skip the [y/N] prompt; write immediately. */
  yes?: boolean;
  /** --typography: enable rule 8 for this invocation. */
  typography?: boolean;
  /**
   * Read user input. Default is process.stdin; tests inject a fake.
   * Returns "y", "yes", or anything else (treated as "no").
   */
  prompt?: () => Promise<string>;
}

export interface CleanCliResult {
  result: CleanResult;
  /** What we did with the result. */
  action: "no-changes" | "wrote" | "skipped" | "check-clean" | "check-dirty";
  /** Human-readable summary of the result. */
  summary: string;
  exitCode: number;
}

/**
 * Run tender clean against a single file. The file is resolved relative to
 * the cwd; project.yaml in the same directory (if present) provides the
 * `clean.typography` setting.
 */
export async function clean(
  filePath: string,
  opts: CleanCliOptions = {}
): Promise<CleanCliResult> {
  const absolute = resolve(filePath);
  const projectDir = dirname(absolute);

  // Resolve typography preference: CLI flag wins; otherwise project config.
  let typography = opts.typography ?? false;
  if (!typography) {
    try {
      const config = await loadProjectConfig(projectDir);
      typography = config.clean?.typography === "smart";
    } catch {
      // No project.yaml or unparseable; treat as no preference.
    }
  }

  const source = await readFile(absolute, "utf8");
  const result = await cleanText(source, { typography });

  const fileLabel = basename(absolute);
  const total = totalChanges(result);

  if (total === 0) {
    return {
      result,
      action: "no-changes",
      summary: `${fileLabel}: no changes.`,
      exitCode: 0
    };
  }

  // --check: report and exit; never write.
  if (opts.check) {
    return {
      result,
      action: "check-dirty",
      summary: formatChangeSummary(fileLabel, result, true),
      exitCode: 1
    };
  }

  // Build the human-facing summary regardless of write decision.
  const summary = formatChangeSummary(fileLabel, result, false);

  // --yes: write immediately.
  if (opts.yes) {
    await writeFile(absolute, result.output);
    return {
      result,
      action: "wrote",
      summary,
      exitCode: 0
    };
  }

  // Default: print summary, prompt.
  const promptFn = opts.prompt ?? defaultPrompt;
  process.stdout.write(`${summary}\n${total} change${total === 1 ? "" : "s"}. Apply? [y/N] `);
  const answer = (await promptFn()).trim().toLowerCase();
  if (answer === "y" || answer === "yes") {
    await writeFile(absolute, result.output);
    return { result, action: "wrote", summary, exitCode: 0 };
  }
  return { result, action: "skipped", summary, exitCode: 0 };
}

function formatChangeSummary(
  fileLabel: string,
  result: CleanResult,
  forCheck: boolean
): string {
  const lines: string[] = [`${fileLabel}:`];
  for (const c of result.changes) {
    lines.push(`  ${c.description}`);
  }
  if (forCheck) {
    lines.push("");
    lines.push("Run `tender clean` (without --check) to apply these changes.");
  }
  return lines.join("\n");
}

async function defaultPrompt(): Promise<string> {
  return new Promise(resolve => {
    process.stdin.once("data", chunk => resolve(chunk.toString()));
  });
}

export { formatChangeSummary };
```

**Step 2: Wire into cli.ts**

```ts
// In packages/cli/src/cli.ts, add the import and command:

import { clean } from "./commands/clean.js";

// ... after existing commands, add:

program.command("clean [path]")
  .description("Sanitise content.md: strip paste artifacts, optionally apply smart typography")
  .option("--check", "exit non-zero if changes are pending; don't write")
  .option("--yes", "skip the confirmation prompt; write immediately")
  .option("--typography", "apply smart-typography rules (default: off)")
  .action(async (path: string | undefined, opts: { check?: boolean; yes?: boolean; typography?: boolean }) => {
    const target = resolve(path ?? "content.md");
    const { summary, exitCode } = await clean(target, opts);
    if (summary) console.log(summary);
    if (exitCode !== 0) process.exit(exitCode);
  });
```

**Step 3: Write CLI tests**

```ts
// packages/cli/src/commands/clean.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clean, formatChangeSummary } from "./clean.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "tender-clean-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("clean command", () => {
  it("writes a cleaned file when --yes is set", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "hello world\n");
    const r = await clean(path, { yes: true });
    expect(r.action).toBe("wrote");
    expect(r.exitCode).toBe(0);
    const after = await readFile(path, "utf8");
    expect(after).toBe("hello world\n");
  });

  it("--check exits 1 when changes are pending; doesn't write", async () => {
    const path = join(tmp, "content.md");
    const original = "hello world\n";
    await writeFile(path, original);
    const r = await clean(path, { check: true });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("check-dirty");
    const after = await readFile(path, "utf8");
    expect(after).toBe(original);
  });

  it("--check exits 0 on a clean file", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "clean prose\n");
    const r = await clean(path, { check: true });
    expect(r.exitCode).toBe(0);
    expect(r.action).toBe("no-changes");
  });

  it("default mode prompts; writes on 'y'", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "hello world\n");
    const r = await clean(path, { prompt: async () => "y\n" });
    expect(r.action).toBe("wrote");
    const after = await readFile(path, "utf8");
    expect(after).toBe("hello world\n");
  });

  it("default mode prompts; does not write on 'n'", async () => {
    const path = join(tmp, "content.md");
    const original = "hello world\n";
    await writeFile(path, original);
    const r = await clean(path, { prompt: async () => "n\n" });
    expect(r.action).toBe("skipped");
    const after = await readFile(path, "utf8");
    expect(after).toBe(original);
  });

  it("reports 'no changes' on a clean file", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "clean prose\n");
    const r = await clean(path, { yes: true });
    expect(r.action).toBe("no-changes");
    expect(r.summary).toMatch(/no changes/);
  });

  it("--typography produces different output than no flag for content with `--`", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "wait -- pause\n");
    const without = await clean(path, { yes: true });
    // Reset.
    await writeFile(path, "wait -- pause\n");
    const withFlag = await clean(path, { yes: true, typography: true });
    expect(withFlag.result.output).not.toBe(without.result.output);
    expect(withFlag.result.output).toContain("—");
  });

  it("project.yaml clean.typography: smart is equivalent to --typography", async () => {
    await writeFile(
      join(tmp, "project.yaml"),
      "page-templates: { default: { size: A5, margin: 0 } }\nclean: { typography: smart }\n"
    );
    const path = join(tmp, "content.md");
    await writeFile(path, "wait -- pause\n");
    const r = await clean(path, { yes: true });
    expect(r.result.output).toContain("—");
  });

  it("running clean twice produces no changes the second time", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "﻿hello world​\n");
    const first = await clean(path, { yes: true });
    expect(first.action).toBe("wrote");
    const second = await clean(path, { yes: true });
    expect(second.action).toBe("no-changes");
  });

  it("formatChangeSummary lists each rule's description", () => {
    const text = formatChangeSummary("content.md", {
      output: "x",
      changes: [
        { code: "clean/bom", count: 1, description: "BOM removed" },
        { code: "clean/nbsp", count: 3, description: "3 NBSPs normalized to space" }
      ]
    }, false);
    expect(text).toContain("BOM removed");
    expect(text).toContain("3 NBSPs normalized");
  });
});
```

**Step 4: Build, test, commit**

```
pnpm -r build
pnpm --filter @tender/cli test -- --run src/commands/clean.test.ts
```

Expected: PASS, 9 tests.

```
git add packages/cli/src/commands/clean.ts \
        packages/cli/src/commands/clean.test.ts \
        packages/cli/src/cli.ts
git commit -m "$(cat <<'EOF'
feat(cli): tender clean command (tender clean step 15)

Wraps cleanText with file I/O, an interactive [y/N] prompt, and
three flags:

- --check: exit 1 if changes pending; never write.
- --yes: skip prompt; write immediately.
- --typography: enable rule 8 for this invocation.

Project-config integration: when project.yaml's clean.typography
is "smart", the command behaves as if --typography were passed.
The CLI flag overrides config-to-on, never to-off.

Tests cover: write-on-yes, no-write-on-check, prompt-then-write,
prompt-then-skip, no-op on clean files, typography flag and config
equivalence, idempotency on repeated runs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Integration fixture — paste-artifact round-trip

**Files:**
- Create: `packages/core/test/fixtures/coastal-planet-paste-artifact/` (full fixture, derived from coastal-planet-tags)
- Create: `packages/core/src/build.test.ts` assertion

**Step 1: Build the fixture**

Copy `coastal-planet-tags` to `coastal-planet-paste-artifact`, then deliberately introduce paste artifacts in `content.md`:

```
cp -r packages/core/test/fixtures/coastal-planet-tags \
      packages/core/test/fixtures/coastal-planet-paste-artifact
```

Edit `content.md` to add:
- A leading BOM (`﻿`)
- Several `\r\n` line endings
- One zero-width space mid-paragraph
- One soft hyphen
- Two NBSPs (one in attribute value — should be preserved; one in prose)
- One line with trailing whitespace
- One run of three blank lines (to be collapsed)
- A few smart-typography candidates: `--`, `...`, straight quotes around prose

Don't introduce so many that the fixture becomes hard to read; ~10 changes total is enough to exercise every rule.

Add `clean.typography: smart` to its `project.yaml` so the typography rule fires.

Save a hand-written "expected" version at `coastal-planet-paste-artifact-expected.md` next to the fixture (or as a sibling fixture). After cleaning, the original file should equal the expected file byte-for-byte.

**Step 2: Add the assertion**

In `packages/core/src/build.test.ts` (the standalone integration test file), add:

```ts
it("coastal-planet-paste-artifact: cleans to the expected byte-identical content", async () => {
  const dir = join(fixturesDir, "coastal-planet-paste-artifact");
  const dirty = await readFile(join(dir, "content.md"), "utf8");
  const expected = await readFile(join(dir, "content-expected.md"), "utf8");
  const r = await cleanText(dirty, { typography: true });
  expect(r.output).toBe(expected);
});

it("coastal-planet-paste-artifact: post-clean fixture builds to the same PDF golden as coastal-planet-tags", async () => {
  // After tender clean, the cleaned content should produce the same PDF
  // structure as coastal-planet-tags (which is byte-identical content).
  // Skip this assertion if the user hasn't set up the expected file yet.
  // Belt-and-suspenders: cleaning preserves meaning, not just bytes.
  // ...
});
```

The PDF-golden assertion is optional belt-and-suspenders. The simpler byte-identical-after-clean assertion is the core of the integration test.

**Step 3: Run + commit**

```
pnpm -r build
pnpm --filter @tender/core test
```

```
git add packages/core/test/fixtures/coastal-planet-paste-artifact/ \
        packages/core/src/build.test.ts
git commit -m "$(cat <<'EOF'
test(core): coastal-planet-paste-artifact integration fixture (tender clean step 16)

A copy of coastal-planet-tags with deliberately-introduced paste
artifacts in content.md: leading BOM, mixed line endings, zero-width
char, soft hyphen, NBSPs (one in an attribute value preserved, one
in prose normalized), trailing whitespace, run of three blank lines,
straight quotes, and `--`. project.yaml enables typography.

The integration assertion: cleanText(dirty, { typography: true })
produces byte-identical output to the hand-written expected file.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Documentation refresh

**Files:**
- Modify: `docs/user-guide.md` (substantial rewrite)
- Modify: `README.md`

**Goal:** Bring both documents up to date with everything that's currently shipped — items 1–6 (single-file `.tender` components, tag syntax, page boundaries, slot syntax, inline shortcuts, plus the LSP/extension), lint v1, and the new `tender clean`. Document only the current syntax — no legacy `:::name`, `--- slot ---`, `::::page` examples. Mention the `TENDER_TAG_SYNTAX=0` escape hatch once near the bottom as an emergency-bisection tool.

This is a meaningful rewrite, not a tweak. Treat it as one focused commit. Use `coastal-planet-tags` as the canonical example throughout — its components are all in `components/*.tender` form, content uses `<row>`, `=== page`, `@@ slot`, and the inline `|...|` shortcut is exercised in the sister `coastal-planet-shortcuts` fixture.

### Outline for `docs/user-guide.md`

1. **Mental model.** Project layout: `project.yaml` (settings + page templates), `styles.css` (presentation), `content.md` (prose), `components/*.tender` (component definitions), `assets/` (images + fonts). Three-file split → four-file split.
2. **Source conventions.**
   - Pages: `=== page` markers (not `::::page`); attributes via `=== page{template=cover}`.
   - Block components: `<row>...</row>` tag syntax; attributes inline.
   - Inline components: `<stage-direction>...</stage-direction>` or shortcut form (`|...|` with project-config registration).
   - Multi-slot components: `@@ slotname` markers (not `--- slot ---`).
   - Inline HTML: still passes through.
   - Headings/lists/etc.: vanilla CommonMark.
3. **`.tender` files.** New section explaining the four-section format (frontmatter, template, `<style>`, `<palette>`). One example showing a wrapper-style component (`tag: aside, class: callout`) and one showing a block-template component with params and slots. The legacy `templates:` and `components:` blocks in `project.yaml` are not documented.
4. **`project.yaml` reference.** Updated to show `page-templates`, `typography`, `fonts`, `inline-shortcuts`, `clean`. Drop the `components:` and `templates:` sections (those live in `.tender` files now). Keep header/footer/font/typography reference unchanged.
5. **`styles.css` conventions.** Mostly unchanged. Update the section about CSS cascade to mention `_components.css` (between `_project.css` and `styles.css`).
6. **Authoring patterns.** Update worked examples (two-column layout, bottom-anchored cover, etc.) to use the new syntax. Use `coastal-planet-tags` as the source of truth for any code samples.
7. **Validation.** Replace the old `tender lint` description with the v1 four-check description: unused-component, unknown-component, missing-asset, deprecated-syntax. Mention `--strict` and `--json`.
8. **CLI reference.** Add `tender clean`. Update `tender lint` flags.
9. **Onboarding the typical workflow.** New short section: "Starting from prose you've already written elsewhere." Describes the `tender init → paste → tender clean → tender preview → progressively wrap` flow.
10. **Security considerations.** Unchanged.
11. **What's not in v1.** Remove the soft-hyphen / NBSP / manual-page-break bullets (no longer relevant: the tag pipeline handles them, and the cleaner is for source-level paste artifacts not source-level markup).
12. **Appendix: TENDER_TAG_SYNTAX=0 escape hatch.** One paragraph at the bottom: "If you suspect a regression in the new pipeline, set this env var and the legacy `:::name` directive parser runs instead. Will be removed once the migration is complete."

### Outline for `README.md`

Smaller change. Update:

- The "Project structure" diagram — show `components/` directory.
- The "Commands" list — add `tender clean`.
- The Reference list — link to `docs/plans/2026-05-08-tender-authoring-experience-plan.md` and the various impl plans for design context, link to `coastal-planet-tags` (not `coastal-planet`) as the worked example.

### Step 1: Draft user-guide.md

Open `docs/user-guide.md`. Replace section by section using the outline above. Keep the prose tone consistent with the existing doc — direct, technical, sparing on emoji and headers.

This is mostly a writing task, not a coding task; skip the per-step-test-assert format. The validation is "the CI test suite still passes (no doc-test integration here) and a quick local read for clarity."

Pin the canonical examples by literally copying source from `coastal-planet-tags/`. E.g. for the "two-column row" pattern, copy `components/row.tender` and `content.md` excerpts verbatim — source-of-truth reads better than synthesized examples.

### Step 2: Draft README.md

Make the targeted edits described in the outline.

### Step 3: Visually verify

Render both docs in a Markdown viewer (or just read them top-to-bottom). Look for:
- Stale `:::name` examples missed in the rewrite.
- Broken internal links.
- Outdated code samples (e.g. `attrs: [variant]` vs `params: [variant]`).

### Step 4: Commit

```
git add docs/user-guide.md README.md
git commit -m "$(cat <<'EOF'
docs: refresh user-guide and README for current syntax (tender clean step 17)

Brings both documents up to date with everything that's currently
shipped:

- Single-file .tender components in components/ directory (item 1).
- <name>...</name> tag syntax (item 2).
- LSP and VS Code extension (item 3).
- === page boundary markers (item 4).
- @@ slotname slot syntax (item 5).
- Inline-shortcut registration (item 6).
- tender lint v1 with --strict / --json (item 8 v1).
- tender clean command and its operator model (item 9 v1, just landed).

Documents only the current syntax — no legacy :::name / --- slot --- /
::::page examples. The TENDER_TAG_SYNTAX=0 escape hatch is mentioned
once near the bottom as an emergency-bisection tool.

Adds a new "Onboarding from existing prose" section describing the
tender init → paste → tender clean → tender preview → progressively
wrap flow.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Whole-tree verification + close GH issue

**Step 1: Full sweep**

```
pnpm -r build
pnpm test
pnpm typecheck
```

Expected: All packages green. Test counts roughly:
- core: ~290 (was 236, +54 across types/skip-regions/8 normalizers/orchestrator/schema/integration)
- cli: 33 (was 24, +9 for clean.test.ts)
- preview-ui, render, language-server, vscode-extension: unchanged

If anything was missed during the implementation, fix it in a follow-up commit. Otherwise no commit needed.

**Step 2: Close GH issue #5**

```
gh issue close 5 --repo joshajh/tender --comment "Implemented in trunk; design doc at docs/plans/2026-05-10-tender-clean-design.md, impl plan at docs/plans/2026-05-10-tender-clean-impl.md."
```

**Step 3: Push**

```
git push
```

---

## Done criteria

`tender clean` v1 is complete when:

1. The eight rules are implemented; each has unit tests with positive, negative, and idempotency cases.
2. `cleanText` orchestrates them in order, threading skip regions and surfacing per-rule change counts.
3. `tender clean` CLI works end-to-end against the `coastal-planet-paste-artifact` fixture.
4. `--check`, `--yes`, and `--typography` flags work as documented.
5. Project config `clean.typography: smart` works as documented.
6. Idempotency: `tender clean && tender clean` reports "no changes" the second time.
7. All workspace tests + typecheck green.
8. `docs/user-guide.md` and `README.md` are refreshed to current syntax + new `tender clean`.
9. GH issue #5 closed.

Total task count: 18. Estimated time: a day, with the doc refresh (Task 17) being the largest single chunk.
