# Tender Authoring — Design for Items 4–6

> Scope: design-level decisions for items 4 (`=== page` boundaries), 5 (`@@ slotname`), and 6 (inline shortcuts) in `2026-05-08-tender-authoring-experience-plan.md`.
>
> The implementation plan that consumes this document is `2026-05-09-tender-authoring-items-4-6-impl.md`.

The three items are grouped because they share machinery: each is a string-to-string preprocessor stage that runs before the existing tag-syntax preprocessor, leaving the downstream pipeline (`remarkParse → remarkDirective → resolveComponents → remarkRehype`) untouched. Treating them together keeps the dependencies between stages explicit.

---

## Pipeline shape

The current parser pipeline (after items 1–3):

```
content.md
  → preprocessTags          (item 2)
  → remarkParse, remarkDirective
  → resolveComponents       (item 1's unified resolver)
  → remarkRehype, rehypeStringify
```

After items 4 and 6:

```
content.md
  → preprocessPageBoundaries     (item 4, NEW)
  → preprocessInlineShortcuts    (item 6, NEW)
  → preprocessTags               (existing)
  → remarkParse, remarkDirective
  → resolveComponents            (item 5: extended slot splitter)
  → remarkRehype, rehypeStringify
```

Three preprocessing stages compose. Each takes a string and returns `{ source, sourceMap }` — when the LSP starts consuming source maps, errors thrown deep in the pipeline trace back to original-source offsets through three layers.

`tagSyntaxEnabled()` (controlled by `TENDER_TAG_SYNTAX=0`) gates all three preprocessors as a group. Disabling tag syntax also disables markers and shortcuts; that's the right granularity because they share the new authoring style.

---

## Item 4 — `=== page` boundaries

### Goal

Replace `<page>...</page>` blocks with column-0 `=== page` markers. Pages stop being deeply-nested and become a stream of sections.

### Syntax

A line at column 0 of the form `=== page` (with optional `{attrs}`) marks a page boundary. The marker:

- Closes the current page if one is open.
- Opens the next page (default template if no attrs; specified template otherwise).

```markdown
=== page{template=cover}

# Cover content

=== page

# Body content

=== page{template=chapter-opener}

# Chapter
```

The trailing `page` keyword sidesteps a CommonMark setext H1 collision: bare `===` after a heading line forms an H1 underline, but `=== page` doesn't.

### Implementation

New module `packages/core/src/parse/preprocess-page-boundaries.ts`.

The preprocessor walks the source line by line. A line matching `^=== page(\{[^}]*\})?\s*$` at column 0 is a page marker. The output is a string with synthetic `<page>...</page>` blocks where the input had markers:

- Lead content (anything before the first marker) → wrapped in implicit `<page>...</page>` *if it contains anything other than whitespace*.
- Each marker closes the previous page and opens a new one with parsed attributes.
- Trailing content closes the final page.

Output goes to `preprocessTags`, which sees explicit `<page>` tags and resolves them via the built-in `page` component already declared in `builtins.ts`.

Skip rules match `preprocessTags`: don't transform inside fenced code blocks (` ``` ` or `~~~`) or HTML comments. The marker must also be on a line of its own with surrounding blank lines — typo-prone forms like `text === page text` aren't markers, they're prose.

### Mixing with explicit `<page>` tags

Authors can mix markers and explicit `<page>` tags. An explicit `<page>...</page>` wrapping a `=== page` marker is a usage error: the inner marker tries to close the outer explicit page. We detect this and error with a clear message: "page boundary marker `=== page` cannot appear inside an explicit `<page>` block."

Detection: as we scan the source for markers, also count `<page>` openers and `</page>` closers. If we see a marker while the explicit-page depth is greater than zero, error.

### `build.ts` simplification

Today `build.ts` checks `startsWithPage` (computed by `parseProject`) and wraps the body in `<div class="page">` when false. With item 4, the preprocessor *always* emits at least one `<page>` block (either from a marker or from the implicit-lead wrap). `parseProject`'s `startsWithPage` becomes always-true; `build.ts` drops the conditional wrap. Net code reduction.

### Edge cases

- Empty document → no implicit `<page>` emitted; `startsWithPage` stays false; `build.ts`'s wrap kicks in. Backward-compatible behavior for empty fixtures.
- A file with only `=== page` markers and no content between → emits empty `<page></page>` blocks. The renderer handles empty pages gracefully (Paged.js produces a blank sheet).
- Marker inside an `<ad-lib>` body or other component → the preprocessor doesn't know which tags are pages and which aren't. Practical rule: a `=== page` marker at column 0 is *always* a page marker. Components that need literal `=== page` text in their content can use a code span or fenced block.

### Tests

- Marker-only document compiles identically to the same content with explicit `<page>` tags.
- Mixed: `=== page` for body, `<page template="cover">…</page>` for cover. Both forms produce the same HTML.
- Doc with no markers and no explicit pages → `build.ts` wraps the whole thing.
- Marker inside an explicit `<page>` block → error with file:line position.
- Markdown setext H1 (line of `===` after a heading) is not detected as a marker.
- Marker inside a fenced code block is preserved as literal text.

### Fixture migration

`coastal-planet-tags/content.md` switches from `<page>...</page>` blocks to `=== page` markers. The PDF golden remains byte-identical: the preprocessor produces the same `<page>` AST that the explicit-tag form did.

---

## Item 5 — `@@ slotname`

### Goal

Replace `--- slotname ---` with `@@ slotname`. The new form is visually distinct, single-token, and harder to confuse with prose punctuation or horizontal rules.

### Implementation

The slot splitter lives in `packages/core/src/parse/components.ts` as `SENTINEL_LINE_RE = /^---\s+([\w-]+)\s+---$/`. The fix is mechanical: extend the regex to recognize either form.

```ts
const SENTINEL_LINE_RE = /^(?:---\s+([\w-]+)\s+---|@@\s+([\w-]+))\s*$/;
```

The capture-group walk in `explodeSentinels` reads `m[1] ?? m[2]` to get the slot name regardless of which form matched. Both forms feed the same downstream `splitSlots` logic.

### LSP awareness

The diagnostics provider in `packages/language-server/src/providers/diagnostics.ts` currently scans for `--- name ---` markers to flag undeclared slots (`SLOT_MARKER_RE`). The same regex extension applies there.

The LSP's recovery `tender-file-parser.ts` doesn't need changes — it only splits .tender files into sections, not content.md slot bodies.

### Deprecation

The `---` form remains accepted for one release. Item 8 v1's `tender/deprecated-syntax` check flags every `--- name ---` occurrence with a suggestion to convert to `@@ name`.

### Fixture migration

`coastal-planet-tags`, `coastal-planet-tender`, and `coastal-planet` fixtures use `--- suggested ---` inside `<ad-lib>` blocks. They migrate to `@@ suggested` as part of item 5. Goldens stay byte-identical because the slot splitter produces the same AST regardless of which marker form was used.

The legacy `coastal-planet` fixture (which still uses `:::ad-lib`) keeps its `:::` directive form (item 7's `tender migrate` will eventually rewrite it). Only its slot marker changes.

### Tests

- Multi-slot test in `components.test.ts` extended with a `@@`-form variant; assert byte-identical output.
- Mistyped slot name with `@@` form produces the same error as the legacy form (slot-name validation lives in the resolver, untouched).
- A `@@`-form marker in a paragraph mid-line is *not* a slot marker (the regex anchors at column 0).

---

## Item 6 — Inline shortcuts

### Goal

Project-defined single-character marks for the most-used inline components, so `@speaker@` parses as `<speaker-name>speaker</speaker-name>` without typing the full tag.

### Schema

`ProjectConfig` gains an optional field:

```yaml
inline-shortcuts:
  "@": speaker-name
  "%": yellow-tag
  "|": stage-direction
```

Zod schema:

```ts
"inline-shortcuts": z.record(
  z.string().length(1).refine(c => ALLOWLIST.has(c), {
    message: "shortcut character must be one of @ % | §"
  }),
  z.string()
).optional()
```

### Allowlist

Single ASCII characters that don't collide with CommonMark's inline syntax (`*`, `_`, `` ` ``, `~`, `[`, `]`, `(`, `)`, `<`, `>`, `\`, `&`, `#`, `>`, `-`, `+`, `=`) and don't carry strong prose-punctuation expectations:

| Char | Why it's safe |
|------|---------------|
| `@` | Common in handles, but Markdown doesn't claim it. |
| `%` | Rare in prose. |
| `\|` | CommonMark only uses `\|` inside tables, which are an extension. |
| `§` | Non-ASCII section symbol, unambiguous. |

`^` is excluded because pandoc-style superscript (`^x^`) is widely supported and authors hitting that extension would be surprised. `?`, `!`, `:`, `;`, `/`, `$` are excluded because of strong prose-punctuation expectations or URL-like collision risks. Item 6 v1 ships exactly the four above; future characters can be added with an explicit migration if a real need surfaces.

### Validation

When `loadProjectRegistry` runs (or `loadProjectIndex` in the LSP), each declared shortcut is validated:

1. Character is in the allowlist (Zod).
2. Component name resolves to a registered entry.
3. Component is `inline: true`.

Validation errors fold into `ComponentRegistry.diagnostics`. The build pipeline surfaces them; the LSP renders them as project-level diagnostics.

### Algorithm

New module `packages/core/src/parse/preprocess-inline-shortcuts.ts`. Pure string-to-string with a source map.

Walk the source character by character. When we encounter a registered shortcut character `c`:

1. **Backslash escape**: if preceded by an *unescaped* `\`, emit literal `c` (without the backslash) and advance.
2. **Same-line lookahead**: scan forward from `c+1` for the next unescaped occurrence of `c` on the same line (no multi-line shortcuts, matching CommonMark `*emphasis*`). The end character must not be at the very next position (i.e. empty-content `@@` is not a shortcut — it's literal).
3. **Found**: emit `<componentName>...inner...</componentName>` (closed-pair tag form, ready for `preprocessTags`).
4. **Not found**: leave the character as literal.

### Skip rules

The scanner skips:

- Fenced code blocks (`` ``` ``, `~~~`) at line start.
- Inline code spans (`` ` ... ` ``).
- HTML comments (`<!-- ... -->`).
- **Inside `<...>` tag openers/closers** — concern (1) above. We detect a tag opener by seeing `<` followed by a letter, then track until the matching `>` (respecting quoted attribute values). Inside that span, shortcut characters are literal.

### Recursion / nesting

Shortcuts don't nest. `@@inner@outer@` produces an error or literal output — likely literal (nested same-character spans are ambiguous and rare enough to ignore). Different characters can compose: `@speaker@ said *something*` works because the runs don't overlap.

### Source map

Yes — same `SourceMapEntry[]` shape as `preprocessTags`. Each literal segment of the input maps to itself in the output; the synthetic `<...>` wrappers have no preimage.

### Tests

- Shortcut declared and used; output matches equivalent `<component>` form's compiled HTML.
- Escape: `\@not a speaker\@` passes through with the backslashes consumed.
- Empty span (`@@`) at start of line is literal.
- Shortcut character inside a `<row label="@x">` attribute is literal.
- Shortcut character inside a fenced code block is literal.
- Shortcut declared for a non-existent component → error from `loadProjectRegistry`.
- Shortcut declared for a non-inline component → error from `loadProjectRegistry`.
- Shortcut declared for `*` → registration error, names the allowlist.
- Round-trip: a content.md using `@x@` produces byte-identical PDF to the same content with `<speaker-name>x</speaker-name>`.

---

## Cross-cutting

### Source-map composition

`parseProject` becomes the orchestrator. It runs the three preprocessors in order and threads source maps through:

```ts
const r1 = preprocessPageBoundaries(source);
const r2 = preprocessInlineShortcuts(r1.source, opts);
const r3 = preprocessTags(r2.source, opts);
const finalSource = r3.source;
const composedMap = composeMaps([r1.sourceMap, r2.sourceMap, r3.sourceMap]);
```

`composeMaps` is a small helper — given a list of maps each describing one transform, it folds positions back to the original source through every layer. The first user of `composedMap` is the LSP's diagnostics provider when it surfaces parser errors with original-source positions. PR 3.x quality, deferred to a follow-up; the machinery exists.

### Error messages

Each preprocessor's errors include filename and original-source line/column when available. `parseProject` accepts an optional `filename` parameter for these messages; it currently doesn't but the threading is clean.

### Test conventions

Each preprocessor gets its own test file in `packages/core/src/parse/preprocess-*.test.ts`. Each lives next to a few corpus entries in `packages/core/test/fixtures/` if useful. Integration tests through `parseProject` cover the cross-cutting cases (markers + shortcuts + tags interacting in one document).

### Definition of done

The three items are "done" when:

1. The pipeline runs items 4, 6, then 2 in sequence; item 5's slot extension is live.
2. `coastal-planet-tags`'s content.md is migrated to use `=== page` markers and `@@ suggested` slots.
3. The PDF golden for `coastal-planet-tags` remains byte-identical to the pre-migration golden, proving the new syntax produces the same output.
4. A new fixture `coastal-planet-shortcuts` (mirroring tags but using inline shortcuts for `speaker-name` etc.) builds and produces a byte-identical PDF golden.
5. Schema validation rejects bad shortcut declarations with clear messages.
6. The LSP's diagnostics provider sees `@@` slot markers as legitimate and `--- name ---` as deprecated.
