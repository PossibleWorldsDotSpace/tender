# Tender Authoring Experience — Plan

> Scope: turn Tender authoring into something that feels like writing Astro/React-style components for print. Treats the source language, the project layout, the editor (VS Code), scaffolding commands, and feedback loops as one connected surface. Existing build pipeline, render path, and preview UI unchanged unless explicitly noted.

This plan replaces the original `:::name` directive-based authoring surface with a `<component>` tag syntax that mirrors web-component conventions. The full vision:

- **Components live in `components/*.tender` files.** Each is a single-file unit declaring params/slots, the Handlebars HTML template, the matching CSS, and an optional palette example. Like an Astro `.astro` component or a Vue SFC.
- **Components are invoked as tags** in `content.md`: `<row label="45 min">…</row>`, `<callout variant=warning>…</callout>`, `<cover-spiral />`. Self-naming closes; familiar HTML attribute syntax.
- **Pages are stream markers**, not nested fences: `=== page` separates pages instead of `::::page … ::::`.
- **Named slots use `@@ slotname`** inside multi-slot components.
- **Inline shortcuts** are project-defined single-character pairs (`*she pauses*`) that map to inline components.
- **`project.yaml` is for project globals only** — page templates, typography, fonts. Components no longer live there.
- **A real LSP** drives the editor experience: autocomplete, hover, diagnostics, go-to-definition.

The work is grouped into ten items in priority order.

| Item | What | Why this priority |
|---|---|---|
| 1 | Single-file `.tender` components | Foundational — restructures where components live; everything else assumes this layout. |
| 2 | Tag-syntax invocation (`<row>…</row>`) | The biggest authoring-ergonomics win. Replaces `:::row`. |
| 3 | LSP + VS Code extension | Most "is this enjoyable?" judgments are made at the keyboard. Build alongside (2). |
| 4 | Implicit page boundaries (`=== page`) | Removes the fence-counting noise pages currently impose. |
| 5 | Slot syntax (`@@ slotname`) | Replaces `--- slotname ---`; less footgun-prone. |
| 6 | Inline-shortcut registration | Single-character marks for common inline components. |
| 7 | `tender new` scaffolding | Solves the blank-page problem for components, layouts, projects. |
| 8 | Real `tender lint` warnings | Converts lint from "did I break the build?" to "what's the next refinement?" |
| 9 | `tender clean` content normalizer | Fixes the "I just pasted from Word/Docs" pain point. |
| 10 | Directive-call inspector + template composition | Polish: source-mapping in preview; `extends` between components. |

The plan is **not backwards-compatible** with existing `:::name` syntax. A migration command (`tender migrate`) handles the one-shot rewrite of existing projects. Rationale: teach one syntax, don't make people choose. The cost of a clean break is one-time; the cost of two coexisting syntaxes is permanent.

---

## 1. Single-file `.tender` components

### Goal

Every component lives in one file, alongside other components, structured like Astro/Vue/Svelte SFCs. No more juggling `project.yaml`'s `templates:` block and `styles.css` to add or change a single component.

### File format

```
my-doc/
  project.yaml          # globals only: page templates, typography, fonts, inline-shortcuts
  styles.css            # design tokens, base typography, anything not component-specific
  content.md            # prose
  components/
    row.tender
    callout.tender
    spanning-row.tender
    ad-lib.tender
    stage-direction.tender
    cover-spiral.tender
  assets/
    images/
    fonts/
```

A `.tender` file has up to four sections:

1. **Frontmatter** (`---…---`, YAML) — declares `params`, `slots`, `inline: true`. Optional sections like `extends` (for composition) live here too.
2. **Template** — Handlebars-shaped HTML. The component's structural skeleton.
3. **`<style>`** — CSS that gets concatenated into the project's styles at build time. Not actually scoped (selectors still need to be specific) — *colocated* with the component for editing convenience.
4. **`<palette>`** (optional) — example values for the Palette tab in `tender preview`. Replaces today's `palette:` YAML block.

### Worked example: `components/row.tender`

```tender
---
params: [label, icon, speaker, no-break]
---

<div class="row{{#if no-break}} no-break{{/if}}">
  <div class="col-l">
    {{#if speaker}}<span class="speaker-name">{{speaker}}</span>{{/if}}
    {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
    {{#if icon}}<img src="assets/images/{{icon}}.png" alt="" class="margin-icon">{{/if}}
  </div>
  <div class="col-r">{{{body}}}</div>
</div>

<style>
.row {
  display: grid;
  grid-template-columns: 3fr 5fr;
  column-gap: var(--col-gap);
  align-items: first baseline;
  margin-bottom: 1.5em;
}
.row.no-break { break-inside: avoid; }
.col-l {
  display: flex;
  justify-content: space-between;
  align-items: first baseline;
  margin-top: var(--baseline-offset);
}
.margin-label {
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  letter-spacing: 0.02em;
}
.margin-icon {
  width: 1em;
  height: 1em;
  margin-left: 0.5em;
  position: relative;
  top: 0.15em;
}
</style>

<palette>
params: { label: "45 min", icon: "clock" }
body: |
  #### Welcome and introductions

  The opening sets a friendly tone.
</palette>
```

### Worked example: inline component (`components/stage-direction.tender`)

```tender
---
inline: true
---

<span class="stage-direction">{{{body}}}</span>

<style>
.stage-direction { font-style: italic; color: #555; }
</style>
```

### Implementation

- **New parser** (`packages/core/src/parse/tender-file.ts`): given a `.tender` file, split into frontmatter / template / style / palette sections. Validate frontmatter against the existing Zod schemas (Component / Template).
- **Discovery**: at build time, glob `components/**/*.tender` from the project root, parse each, and merge into the in-memory component/template registry that today comes from `project.yaml`.
- **Style concatenation**: each component's `<style>` content is concatenated (in deterministic order — alphabetical by component name) into a generated `_components.css` that loads after `_project.css` and before `styles.css`. The existing render-side request interception extends to serve `_components.css` from memory.
- **Schema simplification**: `project.yaml`'s `components:` and `templates:` blocks become deprecated (still parsed, with a deprecation warning suggesting migration). New projects don't write them.

### Tests

- A `.tender` file with all four sections parses correctly.
- A `.tender` file with frontmatter only (no template) errors clearly.
- A directory of `.tender` files merged with a `project.yaml` `templates:` block: the YAML version still works (deprecation warning), `.tender` wins on name collision.
- The `coastal-planet` fixture, ported to `.tender` files, produces byte-identical PDF golden output to the YAML version.

### Migration

`tender migrate` (see item 7) extracts every entry from `project.yaml`'s `templates:` and `components:` blocks into individual `components/*.tender` files, lifts the matching CSS rules from `styles.css` (best-effort — heuristic class-match), and removes the entries from `project.yaml`. Author reviews the diff and commits.

### Why this lands first

Every other item in the plan assumes components live in `components/*.tender`. Tag-syntax invocation (item 2) needs the LSP to know which tags resolve to components — that registry is built from the file scan. The `tender new` scaffolding generates `.tender` files. Implementing the file format unblocks everything else.

---

## 2. Tag-syntax invocation

### Goal

Replace `:::name{attrs}…:::` with `<name attrs>…</name>`. Components are invoked the way web components are invoked. Closing tags are self-naming. Attributes are HTML-style.

### Syntax

**Block form:**
```markdown
<row label="45 min" icon=clock>
The welcome sets a friendly tone.
</row>
```

**Self-closing for empty-body components:**
```markdown
<cover-spiral />
```

**Inline form:**
```markdown
Welcome. <stage-direction>She gestures.</stage-direction> Today we travel.
```

**Multi-slot form:**
```markdown
<ad-lib>
@@ suggested
"Before we begin, I want to name a few things…"

@@ response
"Try this on for size…"
</ad-lib>
```

The implicit body slot is everything before the first `@@ slotname`. Slots are separated by `@@ slotname` lines at column 0. (See item 5.)

### Attribute syntax

Permissive HTML-attribute parsing:

- `name="value"` — standard.
- `name='value'` — single-quoted, equivalent.
- `name=value` — unquoted, value matches `[^\s>]+`.
- `name` — boolean (presence-only, equivalent to `name=true`).
- Attribute names are kebab-case (`no-break`, not `noBreak`).
- Values are passed to Handlebars as strings; type coercion (bool, number) happens in CSS via `data-*` selectors, not in the template.

### Disambiguation: tag vs raw HTML

Tender's parser pre-scans for tags whose name matches a registered component. Anything else passes through as raw HTML (so `<a>`, `<span>`, `<br>` still work as HTML). This is the **disambiguator**: registration determines whether a tag is a Tender component or raw HTML.

The LSP warns when a tag's name matches an HTML built-in (`<p>`, `<div>`, etc.) so authors don't accidentally shadow them.

### Markdown inside components

The parser **does not** delegate to CommonMark's HTML-block rule. Instead, when a registered component tag is detected, the parser:

1. Captures the content between opener and closer.
2. Parses that content as Markdown (recursively allowing nested components).
3. Substitutes the parsed HTML into the `{{{body}}}` slot.

This means Markdown inside `<row>…</row>` Just Works without blank-line gymnastics. This is the single most important parser-level decision and the reason the syntax can feel native instead of fragile.

### Implementation

- **Pre-remark plugin** (`packages/core/src/parse/component-tags.ts`): walks the source string, finds opener/closer pairs for registered component names, replaces each region with a synthetic AST node carrying the component name + attrs + (still-unparsed) body.
- **Body parsing**: the body string is run through `parseProject` recursively, with the same component registry. Nested components and inline components both work via this recursion.
- **Self-closing detection**: `<name />`, `<name/>`, `<name></name>` all produce empty body.
- **Inline detection**: a tag declared `inline: true` cannot appear at block level; a non-inline tag is allowed in either context. Inline tags within paragraphs are recognized and don't break the paragraph.
- **Quoted-bracket safety**: attribute values containing `>` must be quoted; the tokenizer respects quotes when scanning for the `>` that closes the opener.
- **Case handling**: tag names are case-sensitive. Component file names lowercase by convention. The LSP suggests the registered casing.

### Tests

- Block: `<row label="45 min">body</row>` produces the expected HTML.
- Self-closing: `<cover-spiral />` produces empty body.
- Inline: `<stage-direction>…</stage-direction>` mid-paragraph keeps the paragraph intact.
- Nested: `<row><callout>…</callout></row>` produces correctly-nested HTML.
- Markdown inside: `<row>**bold**</row>` produces a `<strong>` tag.
- Mixed with raw HTML: `<row><span style="color:red">x</span></row>` passes the `<span>` through.
- Unknown tag: `<not-a-component>…</not-a-component>` → diagnostic suggesting either creating the component or correcting the name.
- HTML-shadow warning: a `components/p.tender` triggers an LSP warning at registration time.

### Why this is item 2

It's the most-visible authoring change. The whole "Astro for print" feel hinges on it. Building it second (after `.tender` files exist as a registry source) means the parser has a definitive list of component names to recognize.

---

## 3. LSP + VS Code extension

### Goal

When a dev-designer opens `content.md` or any `.tender` file in VS Code, the editor knows about Tender. Autocomplete, hover, diagnostics, and go-to-definition work against the project's actual component vocabulary. The LSP runs alongside `tender preview`; the two are independent and complementary.

### Live-editing model

**Two timescales:**

- **In-editor (sub-keystroke):** the LSP gives immediate feedback as the user types. Red squiggles for unknown components, autocomplete for tag names and params, hover tooltips. None of this requires saving the file or running the preview.
- **In-browser (sub-second):** `tender preview` keeps doing what it does today — chokidar watches the filesystem, rebuilds on save, pushes a WebSocket reload to the browser. The preview shows the *last saved* state.

The LSP and preview server are independent processes. Typical setup: VS Code on the left half of the screen, browser on the right pointing at `localhost:3993`. Type → squiggles in editor. Save → preview rebuilds.

### File-watching detail

The LSP watches:
- `project.yaml` — for page templates, inline-shortcuts, typography.
- `components/**/*.tender` — for the component registry (added/removed/changed).
- `styles.css` — for design tokens used in hover docs.

On any change: re-parse, rebuild the symbol table, push fresh diagnostics to all open buffers. `.tender` files are cheap to parse; full re-scan on each save is fine.

### Architecture

```
packages/
  language-server/        (NEW)
    src/
      server.ts                 (LSP entry, connection setup)
      project-index.ts          (watches project.yaml + components/, builds registry)
      providers/
        completion.ts           (autocomplete)
        hover.ts                (hover tooltips)
        diagnostics.ts          (real-time validation)
        definition.ts           (go-to-definition)
        document-symbols.ts     (outline view for .tender files)
      tag-parser.ts             (light, recovery-oriented parser for editor feedback)
      protocol-types.ts
    test/
  vscode-extension/       (NEW)
    src/
      extension.ts              (activate, spawn LSP, register associations)
    package.json                (extension manifest, snippets, syntaxes)
    snippets/
      tender.code-snippets
    syntaxes/
      tender.tmGrammar.json     (TextMate grammar for .tender files)
```

### Provider behavior

**Completion provider:**
- After `<` in `content.md` → suggest registered component names (block + inline).
- Inside a tag's attributes → suggest valid `params` for that component.
- After `:` in YAML frontmatter of a `.tender` file → suggest schema keys (`params`, `slots`, `inline`, `extends`, etc.).
- Inside the template section of a `.tender` file → suggest `{{paramName}}` for declared params, `{{{slotname}}}` for slots.

**Hover provider:**
- On a tag name → show the template's HTML (truncated/syntax-highlighted), declared params/slots, source location of the component file.
- On an attribute → show the param's documentation (if a JSDoc-style comment is in the frontmatter).
- On `=== page{template=cover}` → show the resolved page geometry from `project.yaml`.

**Diagnostics provider** (debounced ~150ms on buffer change):
- Unknown component name (range covers the tag).
- Attribute given but not declared in `params:` whitelist.
- Unmatched tags (opener with no closer, or vice versa).
- Required slot missing in a multi-slot component invocation.
- Slot name `@@ wrong` doesn't match any declared slot.
- `=== page` inside a component body (page boundaries are top-level only).
- Component name shadows a built-in HTML element.

Each diagnostic has a code (`tender/unknown-component`, `tender/missing-slot`, etc.) and where applicable a Code Action ("Did you mean `<row>`?", "Generate `components/foo.tender`?").

**Definition provider:**
Cmd/Ctrl-click on `<row>` jumps to `components/row.tender`.

**Document symbols** (for `.tender` files):
Outline showing the four sections (frontmatter, template, style, palette).

### VS Code extension

Minimal: extension manifest, activation conditions, snippets, TextMate grammar.

Activation: workspace contains a `project.yaml` at any depth, OR any `.tender` file. Avoid auto-activating in unrelated Markdown projects.

Snippets:
```jsonc
"Component invocation": {
  "prefix": "row",
  "body": ["<row label=\"$1\" icon=$2>", "$0", "</row>"]
},
"Page break": {
  "prefix": "page",
  "body": ["=== page$1", "", "$0"]
},
"New .tender component": {
  "prefix": "tender",
  "body": [
    "---",
    "params: [$1]",
    "---",
    "",
    "<div class=\"$2\">{{{body}}}</div>",
    "",
    "<style>",
    ".$2 {",
    "  $0",
    "}",
    "</style>",
    ""
  ]
}
```

TextMate grammar: highlight `<component>` tags distinctly from raw HTML in `.md` files; highlight `===`, `@@`, frontmatter, and the `<style>` block in `.tender` files.

### Tests

- Unit tests for the tag-parser against representative inputs.
- LSP integration tests: synthetic workspace with `project.yaml` + `components/*.tender` + `content.md`; assert completion items at given positions; assert diagnostics for known-bad inputs.
- Regression suite per provider.

### Out of scope

- Format-on-save (deferrable; treat as separate design).
- Visual editing of any kind.
- Other editors (Zed, Neovim) — once the LSP is solid, those are mostly packaging work.

---

## 4. Implicit page boundaries

### Goal

Pages become a stream of sections separated by markers, not deeply-nested fences. `=== page` replaces `::::page … ::::`.

### Syntax

A line containing only `=== page` (with optional `{attrs}`) at column 0, surrounded by blank lines, represents a page boundary:

- Closes the current page if one is open.
- Opens the next page (default template if no attrs; specified template otherwise).

```markdown
=== page{template=cover}

# This Coastal Planet

…cover content…

=== page

…body content…

=== page{template=chapter-opener}

# Chapter 1

…chapter content…
```

The doc's first content (before any marker) is wrapped in an implicit default page automatically.

### Why `=== page` and not `===`

Bare `===` collides with CommonMark's setext H1 underline (a heading line followed by `===` becomes an H1). Requiring the trailing `page` keyword sidesteps this and reads as documentation: "start a new page here."

### Implementation

In `parse/project-parser.ts`, before the tag-parser runs: detect `=== page` markers, transform to synthetic page-component invocations. Downstream pipeline unchanged.

```
=== page{template=cover}

X

=== page

Y
```

becomes (conceptually):

```
<page template=cover>X</page>
<page>Y</page>
```

The built-in `page` component (declared in core) wraps content in `<div class="page">` with `data-page-template` for non-default templates.

### Tests

- A doc using only `=== page` markers compiles identically to the same doc using explicit `<page>` tags.
- Mixed: `=== page` for body pages, `<page template=cover>…</page>` for cover. Both forms coexist; markers are sugar.
- Edge: doc with no markers and no explicit pages → entire doc is one default page.
- LSP diagnostic: `=== page` inside a component body errors clearly.

### Migration

`tender migrate --pages-to-markers` rewrites explicit `<page>` blocks to `=== page` where the template is `default`. Optional.

---

## 5. Slot syntax

### Goal

Replace `--- slotname ---` (visually a horizontal rule, easy to mistype, silent failure on typo) with `@@ slotname` — visually distinct, single-token, hard to confuse with prose punctuation.

### Behavior

Inside a multi-slot component, content is divided into named slots:

```markdown
<ad-lib>
@@ suggested

"Before we begin, I want to name a few things…"

@@ response

"Try this on for size…"
</ad-lib>
```

- `@@ slotname` at column 0 marks the start of a slot.
- Content before the first `@@` belongs to the implicit `body` slot.
- Each slot's content is parsed as Markdown.
- Slot name must match one declared in the component's frontmatter `slots:` list.

### Implementation

In `parse/templates.ts` (the slot-explosion logic), extend the slot-sentinel detector to recognize `@@ name` in addition to (or instead of) `--- name ---`. Both feed the same downstream slot logic. Initial release: `@@` is the documented form; `---` is the deprecation form (LSP warns with a Code Action to convert).

### Tests

- Slot in `<ad-lib>` correctly fills `{{{suggested}}}`.
- Mistyped slot name in usage produces an error pointing at the line, suggesting the declared slot names.
- Slot at the very start (no implicit body) works.
- Migration codemod converts `--- name ---` to `@@ name`.

---

## 6. Inline shortcut registration

### Goal

Project-defined single-character marks for the most-used inline components. So `*she pauses*` becomes `<stage-direction>she pauses</stage-direction>`. The same gravity-well as Markdown's built-in `*emphasis*` for project-specific vocabulary.

### Syntax

In `project.yaml`:

```yaml
inline-shortcuts:
  "*": stage-direction
  "@": speaker-name
  "%": yellow-tag
```

Source:
```markdown
@Facilitator A@ Welcome everyone. *She gestures to the room.* We're glad you're here.
```

Becomes:
```html
<span class="speaker-name">Facilitator A</span> Welcome everyone.
<span class="stage-direction">She gestures to the room.</span> We're glad you're here.
```

### Constraints

- Each character is a same-on-both-sides delimiter (`*x*`, not `*x_`).
- Must not collide with CommonMark's existing inline syntax (`*emphasis*`, `_emphasis_`, `` `code` ``, `~~strike~~`). Realistic candidates: `@`, `%`, `^`, `|`, `§`. Reserve a small set; reject others at registration time.
- Escapable with backslash: `\@not a speaker\@`.
- Only resolves to components declared `inline: true`.

### Why `*` is risky despite being natural

CommonMark already gives `*x*` to emphasis. Re-registering it would either break Markdown emphasis or produce confusing parser behavior. **Don't ship `*` as a shortcut character.** Use `@`, `%`, etc.

### Implementation

In `parse/project-parser.ts`, add a remark plugin that runs before the tag parser. Scans text nodes for registered shortcut pairs, rewrites them as inline component invocations.

### Tests

- Shortcut declared and used; output matches equivalent `<component>` form.
- Escaped shortcut passes through literally.
- Shortcut declared for an undeclared component → registration error.
- Shortcut declared for a non-inline component → registration error.
- Shortcut character collides with CommonMark → registration error.

---

## 7. `tender new` scaffolding family

### Goal

Dissolve the blank-page problem. Common authoring tasks become one command that emits a working stub. With `.tender` files as the unit, scaffolding is much simpler than in the YAML-based world.

### Subcommands

**`tender new component <name> [options]`**

Creates `components/<name>.tender` with frontmatter + template + style + palette:

```
tender new component callout --variants warning,info --tag aside
```

**`tender new template <name> [options]`** — alias for component but defaults to the multi-attr/slotted shape:

```
tender new template row \
  --columns 3fr/5fr \
  --baseline first \
  --params label,icon,speaker \
  --gap 8mm
```

Output: a complete `components/row.tender` matching the worked example above.

**`tender new page-template <name> [options]`**

Adds a `page-templates` entry to `project.yaml` with sensible defaults and verso/recto + first-page boilerplate already filled in.

**`tender add layout <name>`**

Pulls a curated layout from the built-in library:
- `two-col-baseline` — the `coastal-planet` row pattern.
- `cover-bottom-anchored` — flex column with `margin-top: auto`.
- `verso-recto-running-heads`
- `multicol-with-figures`
- `chapter-opener-bare-first-page`

Each layout drops one or more `components/*.tender` files into the project, possibly adding to `project.yaml`. Conflict-detection prompts before overwriting.

**`tender migrate`**

One-shot rewrite of an existing `:::name` + YAML-templates project into the new format:

1. Extract every `templates:` and `components:` entry from `project.yaml` into individual `components/*.tender` files.
2. Lift matching CSS rules from `styles.css` into each component's `<style>` block (best-effort heuristic — class-match).
3. Rewrite `content.md`: `:::name{…}…:::` → `<name …>…</name>`, `--- slot ---` → `@@ slot`, `::::page` → `=== page`.
4. Print a diff summary; require `--commit` flag to actually write changes.

### Architecture

`packages/cli/src/scaffold/`:

```
scaffold/
  index.ts                  (dispatch)
  component.ts              (new component / template)
  page-template.ts
  layouts/
    two-col-baseline/
      row.tender.hbs        (Handlebars-templated component file)
      ...
    cover-bottom-anchored/
      ...
  migrate/
    extract-components.ts   (yaml templates → .tender files)
    rewrite-content.ts      (::: → tags; --- → @@; etc.)
    lift-css.ts             (heuristic class-match from styles.css)
  yaml-merge.ts             (CST-preserving project.yaml edits)
```

Use a CST-preserving YAML library (`yaml` package's `Document` API) so `tender new page-template` doesn't reformat the user's `project.yaml`.

### Tests

- Each subcommand against an empty project produces a buildable result.
- Each subcommand against an existing project preserves user content and comments.
- `tender migrate` against the (pre-migration) `coastal-planet` fixture produces output that builds to byte-identical PDF golden.
- Conflict cases prompt or fail with `--force` semantics.

---

## 8. Real `tender lint` warnings

### Goal

Convert `tender lint` from a binary "did the build break?" check into a useful refinement tool. Catches drift between `.tender` files, CSS, and content.md — the kind of thing that compiles fine but indicates rot.

### New checks

| Code | Severity | Description |
|---|---|---|
| `tender/unused-component` | warn | A `components/foo.tender` exists but no `<foo>` invocation in content. |
| `tender/orphan-css-class` | warn | A class in `<style>` (or `styles.css`) that no template emits and no inline HTML uses. |
| `tender/raw-html-with-known-class` | info | Inline HTML uses a class that matches a registered component — suggest the tag form. |
| `tender/declared-slot-never-filled` | warn | Component declares slot `X` but no usage fills it. |
| `tender/missing-asset` | error | `<img src="…">` or `assets/...` reference to a file that doesn't exist. |
| `tender/inconsistent-units` | info | Mixing `px` with `pt`/`mm` in print-critical properties. |
| `tender/component-shadows-html` | warn | Component name matches a built-in HTML tag. |
| `tender/deprecated-syntax` | info | Found `:::name`, `--- slot ---`, or `templates:` block — suggest migration. |

Each warning includes a Code Action where automatic.

### Output format

```
$ tender lint my-doc
warning: components/yellow-tag.tender:1: declared but never used [tender/unused-component]
warning: components/row.tender:42: class ".margin-spiral" defined but no element emits it [tender/orphan-css-class]
info:    content.md:24:1: raw HTML uses class "cover-spiral" — declared as component <cover-spiral> [tender/raw-html-with-known-class]
        suggestion: replace with `<cover-spiral />`

3 warnings, 1 info, 0 errors.
```

Exit code: non-zero only on errors. Warnings/info are informational. `--strict` flag promotes warnings to errors for CI.

### Architecture

`packages/core/src/lint/`:

```
lint/
  index.ts          (run all checks, return Report)
  report.ts         (Report type)
  checks/
    unused.ts
    orphan-css.ts
    raw-html.ts
    missing-assets.ts
    units.ts
    deprecated.ts
  css-analyze.ts    (postcss-based class extraction from <style> blocks + styles.css)
  html-analyze.ts   (cheerio-based class/asset extraction from content + components)
```

CLI `tender lint` orchestrates: build the project up to but not including PDF render, collect artifacts (component registry, generated HTML, parsed CSS, content AST), run each check, format output.

### LSP impact

The LSP runs the cheap checks (unused, orphan, raw-html-with-known-class, deprecated-syntax) on every buffer change. The expensive ones (missing-assets, full CSS analysis) stay in `tender lint`.

### Tests

Each check has a positive fixture (rule fires) and a negative fixture (rule does not fire on legitimate cases). The migrated `coastal-planet` fixture should produce zero warnings.

---

## 9. `tender clean` content normalizer

### Goal

Make pasted-from-Word/Docs content land in a parseable state without manual cleanup. The "I copy-pasted three pages of prose and now `content.md` is a war zone" pain point.

### Behavior

`tender clean content.md` normalizes a Markdown file in-place (or `--check` for non-destructive dry-run). Default operations:

| Operation | What it does | Configurable |
|---|---|---|
| Smart-quote normalization | Convert `"`/`'` ↔ `“`/`”`/`‘`/`’` per project preference | Yes — `clean.quotes: smart \| dumb` in project.yaml |
| Whitespace normalization | Replace ` `, zero-width chars, mixed line endings | Off-by-default for NBSP if `lang` indicates a language that uses them |
| Em-dash / en-dash unification | `--` → `—`, ` - ` → ` – `, configurable | Yes |
| Paragraph-break detection | Long unbroken paragraphs (Word/Docs paste artifact): suggest blank-line splits | Suggestion only by default; `--auto-split` to apply |
| Trailing-whitespace strip | Trim trailing whitespace from every line | Yes (default on) |
| Soft-hyphen removal | Strip `­` from source (Tender uses CSS hyphenation, not source markup) | Yes (default on) |
| Smart-quote escaping in components | Inside `<component attr="…">`, leave attribute values alone | Always |
| Fence balance check | Warn on unmatched component tags, slot markers, page markers | Always |

The "fence balance check" is the same logic as `tender lint` but scoped to one file and presented as cleanup output.

### Mode

```
$ tender clean content.md
content.md:
  3 smart quote replacements
  1 em-dash conversion (-- → —)
  2 trailing-whitespace lines trimmed
  suggestion: long paragraph at line 47 (412 chars) — consider splitting

Apply? [y/N]
```

`--check` for dry-run; `--yes` to skip the prompt; `--auto-split` to apply the heuristic paragraph split.

### Implementation

`packages/cli/src/commands/clean.ts`:

```
clean.ts                  (CLI entry, prompt logic, file I/O)
normalizers/
  quotes.ts
  whitespace.ts
  dashes.ts
  paragraph-split.ts
  fences.ts
```

Each normalizer is a pure `(input: string, opts) => { output: string; changes: Change[] }` function. The CLI runs them in order and reports the aggregate changes.

### Tests

- Each normalizer has positive and negative fixtures.
- Idempotency: running `tender clean` twice on the same file produces no changes the second time.
- Non-destructive in `--check` mode.
- Doesn't touch attribute values inside component tags (regression: smart-quoting `<row label="45 min">` would break the parser).

### Why this matters

For the target audience — print designers willing to write code — the friction isn't only "syntax I don't know." Half of it is "I have a 60-page manuscript in Word and I just need it into Tender." Without a cleanup step, that lands as a single giant paragraph with curly quotes everywhere, and the author has to hand-fix it. With `tender clean`, paste → run → file is sane.

---

## 10. Polish: inspector + template composition

These are real wins but lower-priority than the core authoring restructure. Grouping them as "round 4."

### 10a. Directive-call inspector in preview

Read-only counterpart to the LSP's authoring-time hover. In `tender preview`, an "Inspect" mode (toggle via keyboard `i`) lets you click any rendered element and see:

- **Source:** `content.md:42:1` — which `<row>…</row>` produced this, with a link that opens VS Code at the line (via `vscode://` URL handler).
- **Component:** `components/row.tender:N` — the resolving component.
- **CSS rules applying:** ranked by specificity, each linked to its source line.
- **Computed key properties:** `display`, `font-size`, `line-height`, `column-gap`, `break-inside`, etc.

Implementation: source-mapping plumbing through core (each rendered element gets `data-tender-source="content.md:42:1"` and `data-tender-component="row"` in preview-mode-only builds). The inspector panel mounts in the SPA shell next to the iframe.

### 10b. Component composition (`extends`)

Components can extend other components, factoring shared structure. Removes duplication between e.g. `row` and `ad-lib` (both currently re-declare a 2-col grid).

In `components/two-col.tender`:
```tender
---
slots: [left, right]
params: [no-break]
---

<div class="grid-2col{{#if no-break}} no-break{{/if}}">
  <div class="col-l">{{{left}}}</div>
  <div class="col-r">{{{right}}}</div>
</div>

<style>
.grid-2col {
  display: grid;
  grid-template-columns: 3fr 5fr;
  column-gap: var(--col-gap);
  align-items: first baseline;
}
</style>
```

In `components/row.tender`:
```tender
---
extends: two-col
params: [label, icon, speaker, no-break]
slots:
  left: |
    {{#if speaker}}<span class="speaker-name">{{speaker}}</span>{{/if}}
    {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
    {{#if icon}}<img src="assets/images/{{icon}}.png" class="margin-icon">{{/if}}
  right: "{{{body}}}"
---
```

Resolution at registration time: detect `extends`, pull base template, merge params (child wins), fill base's slots from child's `slots:` map. Cycles error.

CSS implication: child's `<style>` is appended to parent's; the parent's classes still apply (no class renaming).

LSP impact: hover on `<row>` shows the resolved template post-composition with provenance ("inherited from `two-col`").

---

## Implementation order

1. **Single-file `.tender` components (1)** — restructures where components live; nothing else makes sense without it.
2. **Tag-syntax invocation (2)** — the headline authoring change.
3. **LSP (3)** — alongside (2), so the syntax launches with editor support.
4. **Implicit page boundaries (4)**, **slot syntax (5)**, **inline shortcuts (6)** — three small language refinements that ship as a batch. Each is a small parser change with backwards-compat handling.
5. **`tender new` scaffolding (7)** — once the file format is stable.
6. **`tender migrate`** — ships with (7), enabling existing projects to upgrade.
7. **`tender lint` warnings (8)** — naturally extends from the LSP's diagnostic infrastructure.
8. **`tender clean` (9)** — independent of everything; can ship anytime in the second half.
9. **Inspector (10a) + composition (10b)** — last; both are polish on a working system.

The first three items are the substantive change. Once they ship, the rest are additive refinements.

## Non-goals

- A WYSIWYG content editor. The editor is text + LSP, not a rich editor.
- Auto-fence-balancing or other "magic fixes" that hide structural mistakes.
- Wider directive vocabulary. The lever is making existing primitives better, not adding more.
- Figma export integrations.
- JS in components (no reactivity, no client islands, no scoped JS). Templates stay as Handlebars-shaped macros.
- Multiple invocation syntaxes coexisting long-term. Migrate cleanly to tags; deprecate `:::name`.

## Cross-reference: code-review issues

The original code review surfaced issues outside the authoring-experience scope; most are now landed via the code-quality plan (`2026-05-08-tender-code-quality-plan.md`). Items addressed here:

- **Lint stub** (`result.warnings` declared but unpopulated) → item 8 rebuilds it as a real check system.
- **Schema-level errors degrade** (Zod errors reach user verbatim) → item 3's diagnostics provider gives precise authoring-time errors.
- **No template composition** → item 10b introduces `extends`.
- **Density of `compose/project-css.ts:138-204`** → addressed in the code-quality plan; further indirectly by 10b (shared structure factors out via composition).

The remaining code-review items (dead `parseMarkdown`, build.ts regex heuristic, `inlineAssets` regex, golden tests, persistent Chromium, render timeout, README docs, cover-spiral investigation, project-css refactor) all landed via the code-quality plan in commit `b845330`'s sequel — so they don't need re-tracking here.
