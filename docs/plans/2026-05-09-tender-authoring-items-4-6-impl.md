# Tender Authoring Items 4–6 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land items 4 (`=== page` boundaries), 5 (`@@ slot` syntax), and 6 (inline shortcuts) — three parser preprocessor stages that share machinery and conventions.

**Architecture:** Items 4 and 6 are new pure string→string preprocessing passes that run before the existing `preprocessTags`. Item 5 is a small extension to the slot-sentinel regex in the existing resolver. All three compose source maps so downstream errors trace back to original-source positions. The pipeline becomes `preprocessPageBoundaries → preprocessInlineShortcuts → preprocessTags → remarkParse → ...`.

**Tech Stack:** TypeScript, vitest, the existing `@tender/core` parser pipeline.

**Reference:** `docs/plans/2026-05-09-tender-authoring-items-4-6-design.md`.

---

## Notes for the implementing engineer

- `pnpm -r build` rebuilds all packages. **You must rebuild `@tender/core` after every source change before render-package or cli-package tests will see your changes** — the cross-package imports go through `dist/`. Failing to rebuild produces confusing test failures where unit tests pass but golden/preview tests fail.
- Goldens live in `packages/render/src/golden/golden/`. Regenerate with `TENDER_UPDATE_GOLDENS=1 pnpm --filter @tender/render test`. Always re-run without the env var afterward to confirm stability.
- The `preprocessTags` module is your reference architecture for items 4 and 6. Read `packages/core/src/parse/preprocess-tags.ts` end to end before writing item 4.
- `coastal-planet-tags` is the integration fixture. It shares assets and components with `coastal-planet-tender`; only its `content.md` differs. Keep it that way — when you migrate it for items 4/5, the byte-equivalence to `coastal-planet-tender.json` golden is the strongest signal you got the migration right.
- Conventional commits (`feat(core): …`, `test(core): …`) with the `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer per CLAUDE.md.

---

## Task 1: `preprocessPageBoundaries` — pure function + tests

**Files:**
- Create: `packages/core/src/parse/preprocess-page-boundaries.ts`
- Create: `packages/core/src/parse/preprocess-page-boundaries.test.ts`

**Step 1: Write the test fixture**

Create `preprocess-page-boundaries.test.ts` with these cases:

```ts
import { describe, it, expect } from "vitest";
import { preprocessPageBoundaries } from "./preprocess-page-boundaries.js";

describe("preprocessPageBoundaries — markers", () => {
  it("wraps lead content in an implicit <page>", () => {
    const r = preprocessPageBoundaries("# Hello\n\nA paragraph.\n");
    expect(r.source).toMatch(/^<page>\s*\n\n# Hello\s*\n\nA paragraph\.\s*\n\n<\/page>\s*$/);
  });

  it("rewrites a single marker into matched <page> tags", () => {
    const src = "Lead.\n\n=== page\n\nBody.\n";
    const r = preprocessPageBoundaries(src);
    expect(r.source).toContain("<page>");
    expect(r.source).toContain("</page>");
    // Two pages: lead + body.
    expect((r.source.match(/<page/g) ?? []).length).toBe(2);
    expect((r.source.match(/<\/page>/g) ?? []).length).toBe(2);
  });

  it("forwards attributes from `=== page{template=cover}`", () => {
    const r = preprocessPageBoundaries("=== page{template=cover}\n\nA\n");
    expect(r.source).toContain(`<page template="cover">`);
  });

  it("treats lone whitespace as no-lead (no implicit page emitted before first marker)", () => {
    const r = preprocessPageBoundaries("\n\n=== page\n\nBody.\n");
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
  });

  it("ignores `=== page` inside fenced code blocks", () => {
    const src = "Lead.\n\n```\n=== page\n```\n\nMore.\n";
    const r = preprocessPageBoundaries(src);
    // Should be one implicit page only — the marker inside ``` is literal.
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
    expect(r.source).toContain("=== page");
  });

  it("ignores `=== page` inside HTML comments", () => {
    const r = preprocessPageBoundaries("Lead.\n\n<!-- === page -->\n\nMore.\n");
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
  });

  it("does not match a setext H1 underline (`===` after a heading line)", () => {
    const src = "A heading\n===\n\nBody.\n";
    const r = preprocessPageBoundaries(src);
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
    expect(r.source).toContain("===");
  });

  it("errors on `=== page` inside an explicit <page> block", () => {
    const src = "<page>\n\n=== page\n\nx\n</page>\n";
    expect(() => preprocessPageBoundaries(src)).toThrow(/cannot appear inside/i);
  });

  it("emits a source map covering literal segments", () => {
    const src = "Para.\n\n=== page\n\nMore.\n";
    const r = preprocessPageBoundaries(src);
    // Each entry should round-trip a literal char.
    for (const e of r.sourceMap) {
      const slice = src.slice(e.originalStart, e.originalStart + e.length);
      expect(r.source.slice(e.rewrittenStart, e.rewrittenStart + e.length)).toBe(slice);
    }
  });

  it("does not match marker mid-line", () => {
    const r = preprocessPageBoundaries("Some text === page on a line.\n");
    expect((r.source.match(/<page/g) ?? []).length).toBe(1);
    expect(r.source).toContain("=== page on a line.");
  });
});
```

**Step 2: Verify tests fail**

```
cd /home/jh/repos/tender && pnpm --filter @tender/core test -- --run src/parse/preprocess-page-boundaries.test.ts
```

Expected: FAIL with "Cannot find module" or similar — module doesn't exist yet.

**Step 3: Implement the preprocessor**

Create `preprocess-page-boundaries.ts`. Mirror the shape of `preprocess-tags.ts`:

```ts
export interface PreprocessPagesResult {
  source: string;
  sourceMap: SourceMapEntry[];
}

export interface SourceMapEntry {
  rewrittenStart: number;
  originalStart: number;
  length: number;
}
```

Algorithm:

1. Split into lines (`split("\n")`).
2. Track depth of explicit `<page>...</page>` blocks by scanning each line for `<page` openers and `</page>` closers (simple count; don't worry about nested page edge cases — those are forbidden by the grammar anyway).
3. For each line, decide if it's a marker:
   - Match `^=== page(?:\{([^}]*)\})?\s*$` at column 0.
   - Skip lines inside fenced code blocks (track `\`\`\`` and `~~~` runs at column 0).
   - Skip lines inside HTML comments (track `<!--` start and `-->` end across lines).
   - If inside an explicit `<page>` (depth > 0) → throw with the marker line position.
4. Walk lines with a state machine that emits:
   - When entering "lead content" (any non-empty non-marker line and `pageOpen` is false): emit `<page>\n` and set `pageOpen = true`.
   - On a marker: if `pageOpen`, emit `\n</page>\n`. Then emit `\n<page${attrs}>\n` and set `pageOpen = true`.
   - All other lines: emit verbatim.
   - At EOF: if `pageOpen`, emit `\n</page>\n`.
5. Build `SourceMapEntry[]` for every literal segment copied through.

For attribute parsing, accept the format `template=cover` or `template="cover"`. Reuse the same loose attribute syntax `tryParseTag` accepts. Output `<page template="cover">` with quoted values.

**Step 4: Run tests**

```
pnpm --filter @tender/core test -- --run src/parse/preprocess-page-boundaries.test.ts
```

Expected: PASS, all 10 tests.

**Step 5: Commit**

```
git add packages/core/src/parse/preprocess-page-boundaries.ts \
        packages/core/src/parse/preprocess-page-boundaries.test.ts
git commit -m "$(cat <<'EOF'
feat(core): preprocessPageBoundaries for === page markers (item 4)

Pure string→string preprocessor that rewrites column-0 `=== page`
markers (with optional {attrs}) into matched <page>...</page> tags.
Lead content before the first marker is wrapped in an implicit
<page>. Skips inside fenced code blocks and HTML comments. Errors
when a marker appears inside an explicit <page> block.

Source maps emitted for literal segments so downstream errors can
trace back to original-source positions.

Not yet wired into parseProject — that's the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `preprocessPageBoundaries` into `parseProject`

**Files:**
- Modify: `packages/core/src/parse/project-parser.ts`
- Modify: `packages/core/src/build.ts`

**Step 1: Wire the preprocessor**

In `project-parser.ts`, after `tagSyntaxEnabled()` check but before `preprocessTags`:

```ts
const afterPages = tagSyntaxEnabled()
  ? preprocessPageBoundaries(source).source
  : source;

const processedSource = tagSyntaxEnabled()
  ? preprocessTags(afterPages, buildPreprocessOptions(config)).source
  : afterPages;
```

Add the import. Note that the page preprocessor runs unconditionally inside the `tagSyntaxEnabled` branch — the `=== page` syntax is part of the new pipeline.

**Step 2: Drop the implicit-page wrap from `build.ts`**

Today `build.ts` wraps `parsed` in `<div class="page">` when `startsWithPage` is false:

```ts
const bodyHtml = startsWithPage ? parsed : `<div class="page">${parsed}</div>`;
```

After item 4, the preprocessor *always* emits at least one `<page>` if there's content, so `startsWithPage` is reliable. **But** for backward compatibility with `TENDER_TAG_SYNTAX=0` (which skips preprocessPageBoundaries) and with truly empty docs, keep the conditional. Confirm by reading `build.test.ts` — the `hello` fixture's content.md is just `# Hello, Tender`. With items 4 active that becomes `<page># Hello, Tender</page>` which then resolves through the `page` built-in. Let it Just Work.

**Step 3: Run all tests**

```
pnpm -r build && pnpm test 2>&1 | tail -20
```

Expected: every test passes. Goldens included — the `hello` fixture's PDF should render identically because adding a `<page>` wrap where there wasn't one produces *almost* the same HTML (the `page` built-in adds `class="page"`, which the existing `<div class="page">` wrap also did).

**If the `hello` golden fails:** the page built-in may emit something like `<div class="page">` while `build.ts`'s wrap emitted the same string. Double-check the rendered HTML before regenerating goldens.

**Step 4: Migrate `coastal-planet-tags` to `=== page` markers**

Modify `packages/core/test/fixtures/coastal-planet-tags/content.md`. Replace every `<page>...</page>` block with `=== page` (or `=== page{template=cover}`) markers.

Pattern: a `<page>` opener becomes `=== page` (or `=== page{template=cover}` etc.) on its own line with blank lines around. The matching `</page>` is dropped — the next marker (or EOF) closes the page.

**Step 5: Run the golden test**

```
pnpm -r build
pnpm --filter @tender/render test -- --run src/golden/golden.test.ts -t "coastal-planet-tags"
```

Expected: PASS — byte-identical to the existing golden because the preprocessor produces equivalent `<page>` AST.

**If it fails:** compare the preprocessed source output to the explicit-tag form by adding a temporary log. The most likely culprits are extra whitespace in the synthesized tags (use exactly `\n\n<page>\n\n` and `\n\n</page>\n\n` to match existing patterns) or missing attribute quoting.

**Step 6: Commit**

```
git add packages/core/src/parse/project-parser.ts \
        packages/core/test/fixtures/coastal-planet-tags/content.md
git commit -m "$(cat <<'EOF'
feat(core): wire preprocessPageBoundaries into parseProject (item 4)

The new preprocessor runs before preprocessTags inside the tag-syntax
pipeline. Migrates coastal-planet-tags to use `=== page` markers
instead of explicit <page>...</page> blocks; the PDF golden remains
byte-identical to coastal-planet-tender.json, proving marker syntax
produces equivalent output.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Item 5 — extend slot-sentinel regex to recognize `@@ name`

**Files:**
- Modify: `packages/core/src/parse/components.ts` (around `SENTINEL_LINE_RE`, ~line 96)
- Modify: `packages/core/src/parse/components.test.ts`
- Modify: `packages/language-server/src/providers/diagnostics.ts` (around `SLOT_MARKER_RE`)

**Step 1: Extend the regex**

In `components.ts`:

```ts
// Old: const SENTINEL_LINE_RE = /^---\s+([\w-]+)\s+---$/;
const SENTINEL_LINE_RE = /^(?:---\s+([\w-]+)\s+---|@@\s+([\w-]+))\s*$/;
```

Update the two usages of `m[1]!` to `(m[1] ?? m[2])!`. There are two: in the whole-paragraph match block (around line 130) and in the inline-text-line match block (around line 144).

**Step 2: Add the test**

In `components.test.ts`, in the multi-slot describe block, add:

```ts
it("recognizes @@ slotname as the new slot sentinel", async () => {
  const cfg = {
    "page-templates": { default: { size: "A5", margin: 0 as const } },
    components: {
      "ad-lib": {
        slots: ["suggested"],
        template: `<div class="ad-lib"><div class="s">{{{suggested}}}</div></div>`
      }
    }
  } as unknown as ProjectConfig;
  const src = `<ad-lib>\n@@ suggested\n\n"Hi."\n</ad-lib>\n`;
  const { html } = await parseProject(src, cfg);
  expect(html).toContain('class="ad-lib"');
  expect(html).toContain('"Hi."');
});

it("@@ form produces byte-identical output to legacy --- form", async () => {
  const cfg = {
    "page-templates": { default: { size: "A5", margin: 0 as const } },
    components: {
      "ad-lib": {
        slots: ["suggested"],
        template: `<div class="ad-lib"><div class="s">{{{suggested}}}</div></div>`
      }
    }
  } as unknown as ProjectConfig;
  const a = await parseProject(`<ad-lib>\n@@ suggested\n\n"Hello world."\n</ad-lib>\n`, cfg);
  const b = await parseProject(`<ad-lib>\n--- suggested ---\n\n"Hello world."\n</ad-lib>\n`, cfg);
  expect(a.html).toBe(b.html);
});
```

**Step 3: Run tests**

```
pnpm --filter @tender/core test
```

Expected: PASS. Both new tests pass; existing slot tests still pass.

**Step 4: Update LSP diagnostics provider**

In `packages/language-server/src/providers/diagnostics.ts`, find `SLOT_MARKER_RE`:

```ts
// Old: const SLOT_MARKER_RE = /^---\s+([\w-]+)\s+---\s*$/;
const SLOT_MARKER_RE = /^(?:---\s+([\w-]+)\s+---|@@\s+([\w-]+))\s*$/;
```

Update the consumer to read `(m[1] ?? m[2])!`.

**Step 5: Add an LSP test**

In `packages/language-server/src/providers/diagnostics.test.ts`, add:

```ts
it("recognizes @@ slot markers", () => {
  const result = provideDiagnostics({
    index: syntheticIndex([
      { name: "ad-lib", slots: ["suggested"] }
    ]),
    document: md(
      "<ad-lib>\n@@ suggested\nA\n@@ response\nB\n</ad-lib>"
    )
  });
  // `response` is undeclared; should warn.
  expect(result.length).toBe(1);
  expect(result[0]?.message).toMatch(/Slot "response"/);
});
```

**Step 6: Run all tests**

```
pnpm -r build && pnpm test 2>&1 | tail -10
```

Expected: PASS across the workspace.

**Step 7: Migrate fixtures**

Update three fixtures' content.md files, replacing `--- suggested ---` with `@@ suggested`:

- `packages/core/test/fixtures/coastal-planet/content.md` (legacy YAML fixture; only the slot marker changes)
- `packages/core/test/fixtures/coastal-planet-tender/content.md`
- `packages/core/test/fixtures/coastal-planet-tags/content.md`

**Step 8: Confirm goldens stable**

```
pnpm -r build
pnpm --filter @tender/render test
```

Expected: all goldens pass — the slot splitter produces the same AST whether the marker was `---` or `@@`.

**Step 9: Commit**

```
git add packages/core/src/parse/components.ts \
        packages/core/src/parse/components.test.ts \
        packages/language-server/src/providers/diagnostics.ts \
        packages/language-server/src/providers/diagnostics.test.ts \
        packages/core/test/fixtures/coastal-planet/content.md \
        packages/core/test/fixtures/coastal-planet-tender/content.md \
        packages/core/test/fixtures/coastal-planet-tags/content.md
git commit -m "$(cat <<'EOF'
feat(core): @@ slotname slot syntax (item 5)

Extends the slot-sentinel regex in components.ts and the LSP's
diagnostics provider to recognize `@@ slotname` in addition to the
legacy `--- slotname ---` form. Both feed the same downstream slot
splitter; output is identical regardless of which form was used.

Migrates the three coastal-planet fixtures to the new form. PDF
goldens remain byte-identical because the slot AST is unchanged.

The legacy --- form keeps working for one release; lint v1's
deprecated-syntax check (separate plan) flags occurrences with a
suggestion to convert.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Item 6 schema — `inline-shortcuts` field

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`

**Step 1: Add the schema**

In `schema.ts`, near the top add:

```ts
const SHORTCUT_ALLOWLIST = new Set(["@", "%", "|", "§"]);
```

In the `ProjectConfig` definition, add an optional field:

```ts
"inline-shortcuts": z.record(
  z.string().refine(
    c => c.length === 1 && SHORTCUT_ALLOWLIST.has(c),
    { message: "inline-shortcut character must be one of: @ % | §" }
  ),
  z.string()
).optional(),
```

Export `SHORTCUT_ALLOWLIST` so the preprocessor can reuse it.

**Step 2: Add schema tests**

In `schema.test.ts`:

```ts
it("accepts an inline-shortcuts mapping with allowlisted characters", () => {
  const c = ProjectConfig.parse({
    "page-templates": { default: { size: "A5", margin: 0 } },
    "inline-shortcuts": { "@": "speaker-name", "%": "yellow-tag" }
  });
  expect(c["inline-shortcuts"]?.["@"]).toBe("speaker-name");
});

it("rejects shortcut characters outside the allowlist", () => {
  expect(() =>
    ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      "inline-shortcuts": { "*": "stage-direction" }
    })
  ).toThrow(/allowlist|allowed|@ % \| §/);
});

it("rejects multi-character shortcut keys", () => {
  expect(() =>
    ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      "inline-shortcuts": { "@@": "x" }
    })
  ).toThrow();
});
```

**Step 3: Run tests**

```
pnpm --filter @tender/core test -- --run src/config/schema.test.ts
```

Expected: PASS.

**Step 4: Commit**

```
git add packages/core/src/config/schema.ts packages/core/src/config/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(core): inline-shortcuts schema and allowlist (item 6 step 1)

Adds the `inline-shortcuts:` field to ProjectConfig and an explicit
allowlist of safe characters (@, %, |, §). Other characters are
rejected at config-load time with a clear message naming the
allowlist. Multi-character keys are also rejected.

The preprocessor that consumes these declarations is the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Item 6 — registration validation in `loadProjectRegistry`

**Files:**
- Modify: `packages/core/src/parse/load-project-registry.ts`
- Modify: `packages/core/src/parse/load-project-registry.test.ts`

**Step 1: Add validation**

In `loadProjectRegistry`, after building the merged component map, validate each shortcut:

```ts
const shortcuts = config["inline-shortcuts"] ?? {};
for (const [char, name] of Object.entries(shortcuts)) {
  const entry = registry.byName.get(name);
  if (!entry) {
    diagnostics.push({
      severity: "error",
      message: `inline-shortcut "${char}" maps to unknown component "${name}"`,
      source: { path: yamlPath }
    });
    continue;
  }
  if (!entry.def.inline) {
    diagnostics.push({
      severity: "error",
      message: `inline-shortcut "${char}" maps to non-inline component "${name}"; component must declare \`inline: true\``,
      source: { path: yamlPath }
    });
  }
}
```

**Step 2: Add tests**

```ts
it("flags an inline-shortcut for an unknown component", async () => {
  const dir = await fixture({
    "project.yaml": [
      minimalYaml,
      "inline-shortcuts: { '@': nonexistent }"
    ].join("\n")
  });
  try {
    const { registry } = await loadProjectRegistry(dir);
    expect(registry.diagnostics.some(d =>
      d.severity === "error" && /unknown component/.test(d.message)
    )).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("flags an inline-shortcut for a non-inline component", async () => {
  const dir = await fixture({
    "project.yaml": [
      minimalYaml,
      "components:",
      "  callout: { tag: aside, class: callout }",
      "inline-shortcuts: { '@': callout }"
    ].join("\n")
  });
  try {
    const { registry } = await loadProjectRegistry(dir);
    expect(registry.diagnostics.some(d =>
      d.severity === "error" && /non-inline/.test(d.message)
    )).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

**Step 3: Run tests + commit**

```
pnpm --filter @tender/core test -- --run src/parse/load-project-registry.test.ts
```

```
git add packages/core/src/parse/load-project-registry.ts \
        packages/core/src/parse/load-project-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(core): validate inline-shortcuts at registry load (item 6 step 2)

loadProjectRegistry now checks each declared inline-shortcut:
- The mapped component name must exist in the registry.
- The component must be inline:true.

Failures fold into ComponentRegistry.diagnostics (build pipeline
surfaces them; LSP renders them as project-level diagnostics).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `preprocessInlineShortcuts` — pure function + tests

**Files:**
- Create: `packages/core/src/parse/preprocess-inline-shortcuts.ts`
- Create: `packages/core/src/parse/preprocess-inline-shortcuts.test.ts`

**Step 1: Write the test fixture**

```ts
import { describe, it, expect } from "vitest";
import { preprocessInlineShortcuts } from "./preprocess-inline-shortcuts.js";

const speakerOnly = { "@": "speaker-name" };
const speakerAndTag = { "@": "speaker-name", "%": "yellow-tag" };

describe("preprocessInlineShortcuts", () => {
  it("rewrites a same-line span", () => {
    const r = preprocessInlineShortcuts("Welcome @speaker@ everyone.", speakerOnly);
    expect(r.source).toBe("Welcome <speaker-name>speaker</speaker-name> everyone.");
  });

  it("supports multiple shortcut characters in one document", () => {
    const r = preprocessInlineShortcuts("@a@ said %warning%.", speakerAndTag);
    expect(r.source).toBe("<speaker-name>a</speaker-name> said <yellow-tag>warning</yellow-tag>.");
  });

  it("does not span across newlines", () => {
    const r = preprocessInlineShortcuts("@text\nmore@", speakerOnly);
    // No closer on the same line → both `@` are literal.
    expect(r.source).toBe("@text\nmore@");
  });

  it("treats backslash-escaped characters as literal", () => {
    const r = preprocessInlineShortcuts("Email me at \\@user\\@.", speakerOnly);
    expect(r.source).toBe("Email me at @user@.");
  });

  it("treats empty span (`@@`) as literal", () => {
    const r = preprocessInlineShortcuts("Foo @@ bar.", speakerOnly);
    expect(r.source).toBe("Foo @@ bar.");
  });

  it("ignores shortcut characters inside fenced code blocks", () => {
    const src = "Lead.\n\n```\n@x@\n```\n\nMore.";
    const r = preprocessInlineShortcuts(src, speakerOnly);
    expect(r.source).toContain("@x@");
    expect(r.source).not.toContain("<speaker-name>");
  });

  it("ignores shortcut characters inside inline code spans", () => {
    const r = preprocessInlineShortcuts("Use `@x@` literally.", speakerOnly);
    expect(r.source).toContain("`@x@`");
    expect(r.source).not.toContain("<speaker-name>");
  });

  it("ignores shortcut characters inside HTML comments", () => {
    const r = preprocessInlineShortcuts("<!-- @x@ -->", speakerOnly);
    expect(r.source).toBe("<!-- @x@ -->");
  });

  it("ignores shortcut characters inside tag attributes", () => {
    const r = preprocessInlineShortcuts(`<row label="@x@">body</row>`, speakerOnly);
    expect(r.source).toContain(`label="@x@"`);
  });

  it("returns input unchanged when no shortcuts are registered", () => {
    const src = "Hello @world@.";
    const r = preprocessInlineShortcuts(src, {});
    expect(r.source).toBe(src);
  });

  it("emits a source map covering literal segments", () => {
    const src = "@a@ and @b@";
    const r = preprocessInlineShortcuts(src, speakerOnly);
    for (const e of r.sourceMap) {
      expect(src.slice(e.originalStart, e.originalStart + e.length))
        .toBe(r.source.slice(e.rewrittenStart, e.rewrittenStart + e.length));
    }
  });
});
```

**Step 2: Verify tests fail**

Run them; they should fail with module-not-found.

**Step 3: Implement**

Create `preprocess-inline-shortcuts.ts`. Algorithm in design doc §6 "Algorithm". Key implementation points:

```ts
export interface PreprocessShortcutsOptions {
  // map of character → component name
  shortcuts: Record<string, string>;
}

export interface PreprocessShortcutsResult {
  source: string;
  sourceMap: SourceMapEntry[];
}

export function preprocessInlineShortcuts(
  source: string,
  shortcuts: Record<string, string>
): PreprocessShortcutsResult {
  // ...
}
```

Walk character by character. At each `i`:

1. If at a fence (` ``` ` or `~~~` at line start) → skip past the closing fence.
2. If at `<!--` → skip past `-->`.
3. If at `` ` `` → skip past the matching closing backtick run.
4. If at `<` followed by a letter → skip past the matching `>` (be careful about quoted attribute values; reuse the same inside-attribute logic preprocessTags uses).
5. If at `\` followed by a registered shortcut char → emit just the shortcut char (consume the backslash) and advance past both.
6. If at a registered shortcut char `c`:
   - Lookahead on the same line for the next *unescaped* `c`.
   - If found at position `j > i+1` (non-empty span): emit `<componentName>` + literal slice `[i+1, j)` + `</componentName>`; advance to `j+1`.
   - Else: emit literal `c`; advance.
7. Default: copy literal char and advance.

Maintain the source map by recording each literal slice's `(rewrittenStart, originalStart, length)`.

For the inside-tag-opener detection, you can reuse the simple state machine: when you see `<[a-zA-Z]`, scan forward to `>` while tracking quoted regions (double or single quotes). Inside that range, no shortcut substitution happens.

**Step 4: Run tests + commit**

```
pnpm --filter @tender/core test -- --run src/parse/preprocess-inline-shortcuts.test.ts
```

```
git add packages/core/src/parse/preprocess-inline-shortcuts.ts \
        packages/core/src/parse/preprocess-inline-shortcuts.test.ts
git commit -m "$(cat <<'EOF'
feat(core): preprocessInlineShortcuts pure preprocessor (item 6 step 3)

Pure string→string preprocessor that rewrites registered single-
character marks (e.g. @speaker@) into closed-pair component tags
(<speaker-name>speaker</speaker-name>). Constraints:

- Same-line only (no multi-line spans).
- Backslash escapes (\@) pass through literal.
- Skips fenced code, inline code, HTML comments, and the inside of
  tag openers/closers (so attributes like label="@x@" stay literal).
- Unknown shortcut characters or empty spans pass through literal.

Source maps emitted for every literal segment. Wired into
parseProject in the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `preprocessInlineShortcuts` into `parseProject`

**Files:**
- Modify: `packages/core/src/parse/project-parser.ts`

**Step 1: Add the call**

Insert between `preprocessPageBoundaries` and `preprocessTags`:

```ts
const afterPages = tagSyntaxEnabled()
  ? preprocessPageBoundaries(source).source
  : source;

const shortcuts = config["inline-shortcuts"] ?? {};
const afterShortcuts = tagSyntaxEnabled()
  ? preprocessInlineShortcuts(afterPages, shortcuts).source
  : afterPages;

const processedSource = tagSyntaxEnabled()
  ? preprocessTags(afterShortcuts, buildPreprocessOptions(config)).source
  : afterShortcuts;
```

**Step 2: Run all tests**

```
pnpm -r build && pnpm test
```

Expected: PASS. No fixture uses inline shortcuts yet, so existing goldens are unaffected.

**Step 3: Commit**

```
git add packages/core/src/parse/project-parser.ts
git commit -m "$(cat <<'EOF'
feat(core): wire preprocessInlineShortcuts into parseProject (item 6 step 4)

The new preprocessor runs between preprocessPageBoundaries and
preprocessTags. Existing fixtures don't declare inline-shortcuts, so
no behavior changes for them.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Item 6 integration fixture — `coastal-planet-shortcuts`

**Files:**
- Create: `packages/core/test/fixtures/coastal-planet-shortcuts/` (full fixture, mirrored from `coastal-planet-tags`)
- Modify: `packages/render/src/golden/golden.test.ts` to include the new fixture
- Create: `packages/render/src/golden/golden/coastal-planet-shortcuts.json` (generated)

**Step 1: Copy the fixture**

```bash
cp -r packages/core/test/fixtures/coastal-planet-tags packages/core/test/fixtures/coastal-planet-shortcuts
```

**Step 2: Declare shortcuts in project.yaml**

Edit `packages/core/test/fixtures/coastal-planet-shortcuts/project.yaml`. Add:

```yaml
inline-shortcuts:
  "@": speaker-name
```

**Step 3: Rewrite content.md**

In `coastal-planet-shortcuts/content.md`, find every `<span class="speaker-name">...</span>` (there shouldn't actually be any in the existing tags fixture — the design fixture uses `speaker=...` attributes). Look for opportunities to use `@speaker@` shortcut form *somewhere*. If the fixture doesn't have inline-component invocations to convert, add one or two — e.g. inside a `<row>` body, replace literal text with `@Facilitator A@` to test the shortcut path.

The minimum: at least three `@name@` invocations should appear in the fixture so the golden test exercises the preprocessor.

**Step 4: Wire into golden.test.ts**

Add `"coastal-planet-shortcuts"` to the `FIXTURES` array in `packages/render/src/golden/golden.test.ts`.

**Step 5: Generate golden**

```
pnpm -r build
TENDER_UPDATE_GOLDENS=1 pnpm --filter @tender/render test -- --run src/golden/golden.test.ts
```

**Step 6: Verify stable**

```
pnpm --filter @tender/render test
```

Expected: golden test for `coastal-planet-shortcuts` passes against the just-generated golden.

**Step 7: Build assertion**

In `packages/core/src/build.test.ts`, add a small assertion that the new fixture builds and the rendered HTML contains `<span class="speaker-name">` (proof the shortcut expanded into the inline component).

**Step 8: Commit**

```
git add packages/core/test/fixtures/coastal-planet-shortcuts/ \
        packages/render/src/golden/golden.test.ts \
        packages/render/src/golden/golden/coastal-planet-shortcuts.json \
        packages/core/src/build.test.ts
git commit -m "$(cat <<'EOF'
test(core): coastal-planet-shortcuts fixture and golden (item 6)

Mirrors coastal-planet-tags but uses inline-shortcut declarations
(`"@": speaker-name`) and `@Name@` invocations in content.md. The
preprocessor expands them into <speaker-name>...</speaker-name>
tags before preprocessTags runs; the rendered HTML contains the
inline-component spans as expected.

PDF golden generated under TENDER_UPDATE_GOLDENS=1; subsequent runs
assert byte-stable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Source-map composition helper

**Files:**
- Create: `packages/core/src/parse/compose-source-maps.ts`
- Create: `packages/core/src/parse/compose-source-maps.test.ts`
- Modify: `packages/core/src/parse/project-parser.ts`

**Step 1: Write the helper + test**

Test:

```ts
import { describe, it, expect } from "vitest";
import { composeSourceMaps } from "./compose-source-maps.js";

describe("composeSourceMaps", () => {
  it("returns the input unchanged when there's a single map", () => {
    const map = [{ rewrittenStart: 0, originalStart: 0, length: 5 }];
    expect(composeSourceMaps([map])).toEqual(map);
  });

  it("folds two transforms back to original-source positions", () => {
    // Stage 1: maps "abc" (3 chars at offset 0) to itself.
    const m1 = [{ rewrittenStart: 0, originalStart: 0, length: 3 }];
    // Stage 2: maps "abc" (3 chars) to position 5 in stage-1 output.
    const m2 = [{ rewrittenStart: 5, originalStart: 0, length: 3 }];
    const composed = composeSourceMaps([m1, m2]);
    // Composed should map output position 5 back to original position 0.
    const entry = composed.find(e => e.rewrittenStart === 5);
    expect(entry?.originalStart).toBe(0);
    expect(entry?.length).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(composeSourceMaps([])).toEqual([]);
  });
});
```

Implementation:

```ts
export interface SourceMapEntry {
  rewrittenStart: number;
  originalStart: number;
  length: number;
}

/**
 * Fold a chain of transformations' source maps into a single map that
 * relates final-output positions back to original-source positions.
 *
 * Each input map is the output of one transform: `originalStart` refers
 * to that transform's input (which is the previous transform's output).
 * The composed map's `originalStart` refers to the very first input.
 */
export function composeSourceMaps(maps: SourceMapEntry[][]): SourceMapEntry[] {
  if (maps.length === 0) return [];
  if (maps.length === 1) return maps[0]!;
  // Compose pairwise from left to right: m1 ∘ m2.
  let acc = maps[0]!;
  for (let i = 1; i < maps.length; i++) {
    acc = composePair(acc, maps[i]!);
  }
  return acc;
}

function composePair(m1: SourceMapEntry[], m2: SourceMapEntry[]): SourceMapEntry[] {
  // For each entry in m2 (output→stage-1-output), find the m1 entry that
  // covers its originalStart and translate to m1's originalStart.
  const out: SourceMapEntry[] = [];
  for (const e2 of m2) {
    // Find an m1 entry that contains [e2.originalStart, e2.originalStart + e2.length).
    const e1 = m1.find(e =>
      e.rewrittenStart <= e2.originalStart &&
      e.rewrittenStart + e.length >= e2.originalStart + e2.length
    );
    if (!e1) continue;  // segment isn't traceable; drop it
    const offsetInE1 = e2.originalStart - e1.rewrittenStart;
    out.push({
      rewrittenStart: e2.rewrittenStart,
      originalStart: e1.originalStart + offsetInE1,
      length: e2.length
    });
  }
  return out;
}
```

**Step 2: Run tests**

```
pnpm --filter @tender/core test -- --run src/parse/compose-source-maps.test.ts
```

Expected: PASS.

**Step 3: Use in `parseProject`**

Modify `parseProject` to also return the composed source map:

```ts
export interface ParseResult {
  html: string;
  startsWithPage: boolean;
  sourceMap: SourceMapEntry[];
}
```

Inside the function, capture each preprocessor's map and compose:

```ts
const r1 = preprocessPageBoundaries(source);
const r2 = preprocessInlineShortcuts(r1.source, shortcuts);
const r3 = preprocessTags(r2.source, buildPreprocessOptions(config));
const sourceMap = composeSourceMaps([r1.sourceMap, r2.sourceMap, r3.sourceMap]);
```

When `tagSyntaxEnabled()` is false, return an empty source map (the disable path doesn't preprocess, so positions already match).

**Step 4: Run all tests**

```
pnpm -r build && pnpm test
```

Expected: PASS. The new return field is additive; no consumer reads it yet.

**Step 5: Commit**

```
git add packages/core/src/parse/compose-source-maps.ts \
        packages/core/src/parse/compose-source-maps.test.ts \
        packages/core/src/parse/project-parser.ts
git commit -m "$(cat <<'EOF'
feat(core): compose source maps across the preprocessor pipeline

parseProject now exposes a composed SourceMapEntry[] tracing final
parser output positions back to the original content.md. Folds the
maps from preprocessPageBoundaries, preprocessInlineShortcuts, and
preprocessTags pairwise.

No consumer reads this yet; it's the foundation for surfacing
parser errors with original-source positions in the LSP and CLI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update the design plan reference and verify whole-tree green

**Files:**
- Run: `pnpm test` (all packages)
- Run: `pnpm typecheck`

**Step 1: Full test sweep**

```
pnpm -r build && pnpm test
```

Expected: All packages green. Test counts roughly:
- core: ~190 (was 173, +17 across the new modules)
- language-server: 79 (was 78, +1 for `@@` slot test)
- preview-ui, render, cli: unchanged

**Step 2: Typecheck**

```
pnpm typecheck
```

Expected: clean across all packages.

**Step 3: Goldens (full)**

```
pnpm --filter @tender/render test
```

Expected: 8 PDF goldens pass — `hello`, `components`, `page-templates`, `with-image`, `coastal-planet`, `coastal-planet-tender`, `coastal-planet-tags`, `coastal-planet-shortcuts`.

**Step 4: No-op commit if needed**

If anything was missed or fixed up during the sweep, commit it. Otherwise no commit needed.

---

## Done criteria

Items 4–6 are complete when:

1. `=== page` markers preprocess to `<page>` tags (item 4).
2. `@@ slotname` recognized identically to `--- slotname ---` (item 5).
3. `inline-shortcuts:` declarations in project.yaml expand `@x@`-style marks into closed-pair component tags (item 6).
4. The three fixtures (`coastal-planet`, `coastal-planet-tender`, `coastal-planet-tags`) all use `@@ slotname` and the legacy `--- slotname ---` form is gone from active fixtures (still recognized as a deprecated alias).
5. `coastal-planet-tags` uses `=== page` markers and remains byte-identical to `coastal-planet-tender.json`.
6. `coastal-planet-shortcuts` exists with shortcut declarations and a stable golden.
7. `parseProject` exposes a composed source map.
8. All tests + typecheck green.

Total task count: 10. Estimated time: half a day. Each task is one focused commit.
