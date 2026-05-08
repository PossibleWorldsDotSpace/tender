# Tender Authoring Experience — Plan

> Scope: improve the dev-designer's authoring experience for Tender source. Treats the editor (VS Code), the source language itself, scaffolding commands, and feedback loops as one connected surface. Existing build pipeline, render path, and preview UI unchanged unless explicitly noted.

The work is grouped into nine items in priority order. The first (E) is the highest-leverage and should be built first. The next four (A, B, C, D) refine the source language. The last four (F, G, H, I) extend the surrounding ergonomics.

| Item | What | Why first/last |
|---|---|---|
| E | LSP + VS Code extension | Most "is this enjoyable?" judgments are made at the keyboard. Build first. |
| A | Named closing fences | Removes the biggest navigational friction in nested docs. Backwards compatible. |
| B | Implicit page boundaries | Collapses the nested-fence noise in linear documents. |
| C | Inline shorthand registration | Makes Tender's project-vocabulary feel like Markdown's built-in vocabulary. |
| D | Slot syntax that looks like syntax | Removes a silent-failure footgun. |
| F | `tender new` scaffolding family | Solves the blank-page problem for templates, components, layouts. |
| G | Directive-call inspector in preview | Read-only counterpart to the LSP's authoring-time hover. |
| H | Real `tender lint` warnings | Converts lint from "did I break the build?" to "what's the next refinement?" |
| I | Template composition (`extends`) | Lets authors factor shared structure between templates instead of duplicating it. |

---

## E. LSP + VS Code extension

### Goal

When a dev-designer opens `content.md` in VS Code, the editor knows about Tender. Autocomplete, hover, diagnostics, and go-to-definition work against the project's actual vocabulary. The LSP runs alongside `tender preview`; the two are independent and complementary.

### Live-editing model (answer to "will they see changes live?")

**Yes — on two timescales:**

- **In-editor (sub-keystroke):** the LSP gives immediate feedback as the user types. Red squiggles for unknown components, autocomplete for directive names and params, hover tooltips. None of this requires saving the file or running the preview.
- **In-browser (sub-second):** `tender preview` keeps doing what it does today — chokidar watches the filesystem, rebuilds on save, pushes a WebSocket reload to the browser. The preview shows the *last saved* state.

The LSP and preview server are independent processes. Typical setup: VS Code on the left half of the screen with the LSP active, browser on the right half pointing at `localhost:3000`. As the user types, squiggles appear in the editor. When they save, the preview rebuilds.

One subtlety: the LSP needs to know what's in `project.yaml` to provide autocomplete in `content.md`. It must re-parse `project.yaml` when that file changes (on save, and ideally debounced on buffer change), so newly-declared components autocomplete immediately in other open files.

### Architecture

New package: `@tender/language-server`. Implements the Language Server Protocol; transport-agnostic (stdio for VS Code, can be embedded elsewhere later).

```
packages/
  language-server/        (NEW)
    src/
      server.ts           (LSP entry, connection setup)
      project-index.ts    (loads + watches project.yaml, builds symbol table)
      providers/
        completion.ts     (autocomplete)
        hover.ts          (hover tooltips)
        diagnostics.ts    (real-time validation)
        definition.ts     (go-to-definition)
      directive-parser.ts (light parser — NOT the full remark pipeline)
      protocol-types.ts
    test/
```

A separate package: `@tender/vscode-extension`. Thin wrapper that activates the LSP for `*.md` files in workspaces containing a `project.yaml`.

```
packages/
  vscode-extension/       (NEW)
    src/
      extension.ts        (activate, spawn LSP, register file associations)
    package.json          (extension manifest, snippets, commands)
    snippets/
      tender.code-snippets
    syntaxes/             (optional: TextMate grammar for directive highlighting)
```

### `@tender/language-server` — concrete behavior

**Project index.** On startup and on `project.yaml` change:

- Parse `project.yaml` with the same Zod schema used by core.
- Build an in-memory symbol table: `{components, templates, pageTemplates, params, slots}`.
- Track each symbol's source location (line/column in `project.yaml`) for go-to-definition.
- Cache parse errors to surface as diagnostics on `project.yaml` itself.

**Light directive parser.** A purpose-built parser for *just* the directive surface — no remark, no Handlebars expansion, no HTML output. Input: a buffer's text. Output: a list of directive nodes with `{name, kind: 'block'|'inline', attrs: {key, value, range}, range, fenceRange, closingFenceRange}`. This needs to be fast (sub-50ms on a 60-page doc) and tolerant of broken input — it has to give partial results while the user is mid-keystroke.

This is deliberately *not* the production parser. It's a recovery-oriented parser for editor feedback. Production parsing stays in `@tender/core`.

**Completion provider.** Triggers:

- After `:::` or `::::` at column 0 → suggest block component/template names.
- After `:` followed by a letter → suggest inline component names.
- Inside a directive's `{…}` → suggest valid `params` for this directive.
- Inside `template=` value → suggest registered page-template names.

Each completion item carries documentation (the template body or component definition) and an insertion snippet (so accepting `:::row` autoinserts `\n\n$0\n\n:::`).

**Hover provider.** Hovering over a directive name shows: the template's HTML (truncated/syntax-highlighted), declared `params`, declared `slots`, source location in `project.yaml`. For inline components, the rendered HTML wrapper. For page templates, the resolved page geometry.

**Diagnostics provider.** Runs on every buffer change (debounced ~150ms). Reports:

- Unknown component/template name (range covers the directive name).
- Param given but not declared in `params:` whitelist.
- Required slot missing in usage of multi-slot template.
- Slot name in usage doesn't match any declared slot.
- Mismatched fence depth (more closes than opens, or unclosed at EOF).
- Mismatched named close (when item A lands).

Each diagnostic has a code (`tender/unknown-component`, `tender/missing-slot`, etc.) and where applicable a Code Action ("Did you mean `:::ad-lib`?").

**Definition provider.** Cmd/Ctrl-click on a directive name jumps to the corresponding entry in `project.yaml`.

### `@tender/vscode-extension`

Minimal — just the extension manifest, activation, and a small snippets file. Snippets included out of the box:

```jsonc
"Page": {
  "prefix": "page",
  "body": ["::::page${1: \\{template=$2\\}}", "", "$0", "", "::::"]
},
"Row": {
  "prefix": "row",
  "body": [":::row{label=\"$1\" icon=$2}", "", "$0", "", ":::"]
}
```

Activation conditions: workspace contains a `project.yaml` at any depth; or a `.tender` marker file. Avoid auto-activating in unrelated Markdown projects.

### File-watching detail

The LSP watches `project.yaml` via VS Code's workspace file watcher. On change:

1. Re-parse with Zod schema.
2. Rebuild symbol table.
3. Re-run diagnostics on every open `*.md` buffer (cheap — directive parser is fast).
4. If `project.yaml` itself has parse errors, push diagnostics to it; leave `*.md` diagnostics stale until valid.

### Tests

- Unit tests for the directive parser against the same `coastal-planet` content.
- LSP integration tests via `vscode-languageserver-testbed` (or similar): synthetic workspace with `project.yaml` + `content.md`, assert completion items at given positions, assert diagnostics for known-bad inputs.
- Regression suite: every behavior added later (named close fences, slot syntax) gets a test here too.

### Packaging

VS Code extension published to the marketplace as `tender-vscode`. Versioning tracks the LSP package. The LSP package is also independently consumable so future editor integrations (Zed, Neovim) reuse it.

### Out of scope for this item

- Formatting / format-on-save (deferrable; the source format is loose enough that a formatter is a separate design).
- Visual editing of any kind.
- Other editors. Build VS Code first; once the LSP is solid, Zed/Neovim are mostly packaging work.

---

## A. Named closing fences

### Goal

`:::row` can be closed with `:::row` (or `::::page` with `::::page`), making nested directives self-documenting and mismatch errors precise.

### Behavior

- The closing fence accepts an optional name. The name must match the opener.
- Bare `:::` and `::::` continue to work (backwards compatible).
- Mismatch is a hard error reported with both the opener and closer locations.

### Source change

`packages/core/src/parse/` — the directive parser currently treats `:::` as opaque close. Extend it to capture an optional identifier following the colons, then resolve it against the opener-stack at close time.

### Tests

- Existing fixtures (which use bare closes) still pass.
- New fixture: `coastal-planet` style doc with named closes, asserts identical compiled output.
- Negative cases: `:::row … :::ad-lib` produces a single diagnostic pointing at both lines.

### LSP impact

Diagnostics and completion gain "close fence" awareness — typing `:::` at the right indent level autocompletes to `:::row` matching the most recent unclosed opener.

### Documentation

Update `user-guide.md` §"Pages" and §"Templates" to show the named-close form as the recommended style; mention bare closes still work.

---

## B. Implicit page boundaries

### Goal

In documents that are mostly one-page-per-section, eliminate the `::::page … ::::` wrapper noise. Pages become a *stream* with markers between them, not deeply nested fences.

### Behavior

A new top-level marker — proposed: a line containing only `===` (three or more equals signs at column 0, surrounded by blank lines) — represents an implicit page break:

- Closes the current page (default template) if one is open.
- Opens the next default page.
- Mutually exclusive with explicit `::::page` blocks in the same surrounding scope; the first marker the parser sees in a doc determines the mode.

Explicit `::::page{template=cover}` remains the only way to specify a non-default template. Mixing is fine: `===` opens a default page, `::::page{template=cover}` opens a templated page.

The doc's first content (before any marker) is wrapped in an implicit default page automatically.

### Source change

In `parse/project-parser.ts`, before remark runs: detect `===` markers, transform to implicit `::::page` open/close pairs. This keeps the downstream pipeline unchanged.

### Tests

- Fixture: a document using only `===` markers compiles identically to the same doc using explicit `::::page` wrappers.
- Mixed fixture: `===` for body pages, `::::page{template=cover}` for the cover.
- Edge: doc with no markers at all and no explicit pages → entire doc becomes one default page.

### LSP impact

The directive parser must recognize `===` as a page break. Diagnostics: `===` inside a `:::row` (or any nested directive) is an error — page breaks live at top level only.

### Migration

Optional codemod (`tender migrate --pages-to-markers`) that rewrites explicit `::::page` to `===` where the template is `default`. Not required — the two forms coexist.

### Risk

Choosing `===` may collide with users who write equals-rule horizontal lines. Markdown's CommonMark setext H1 underline is `===` directly under a heading line, which is a different context (no surrounding blanks); the parser must distinguish. Reserve a different marker if collision testing turns up issues — `--- page ---` is a fallback.

---

## C. Inline shorthand registration

### Goal

Project-specific inline marks become as terse as Markdown's built-in `*emphasis*`. The Tender USP — *project-defined vocabulary* — extends to inline shorthand.

### Behavior

`project.yaml` gains an `inline-shortcuts` block:

```yaml
inline-shortcuts:
  "*": stage-direction
  "@": speaker-name
  "%": yellow-tag
```

Source: `*she pauses*` becomes `<span class="stage-direction">she pauses</span>`.

Constraints:

- The character on each side must be the same.
- Must not be already meaningful in CommonMark (so `*` is **out** — it collides with emphasis). Realistic candidates: `@`, `%`, `^`, `~` (collides with strikethrough in GFM — also out unless GFM strikethrough is disabled), `|`, `§`.
- Escapable with backslash: `\@not a speaker\@`.
- Only resolve to components declared with `inline: true`.

A sensible v1: ship with a small set of allowed characters (`@`, `%`, `^`, `|`, `§`) and reject others. The point isn't maximal flexibility; it's making one or two project-specific marks effortless.

### Source change

In `parse/project-parser.ts`, add a remark plugin that runs before directive parsing. It scans text nodes for registered shorthand pairs and rewrites them to inline directive nodes (`:name[content]`), which downstream code already handles.

### Tests

- Fixture with shorthand declared and used; output matches the equivalent `<span class="…">` form.
- Escaped shorthand passes through literally.
- Shorthand declared for an undeclared component: error.
- Shorthand declared for a non-inline component: error.

### LSP impact

Hover on a shorthand pair shows the resolved component. Completion offers the registered shorthand characters when in a text context.

### Documentation

New §"Inline shortcuts" in user-guide. Show the worked-example pattern: `*` for stage directions in a script.

---

## D. Slot syntax that looks like syntax

### Goal

Replace the `--- slotname ---` slot separator (which looks like a horizontal rule) with something visibly structural. Mistypes are caught instead of producing silent empty slots.

### Behavior

New syntax: a line at column 0 of the form `@@ slotname` (or alternative; `@slotname:` or `--- slot: name ---` are options). Picking `@@ slotname` because it's visually distinct, single-token, and can't collide with anything in CommonMark.

```
:::ad-lib

@@ suggested

"Before we begin, I want to name a few things…"

@@ response

"Try this on for size…"

:::
```

Old `--- slotname ---` form still works for one release as a deprecation path; LSP warns on it with a Code Action to convert.

### Source change

In `parse/templates.ts`, extend the slot-sentinel detector. Today it looks for `--- name ---`; add an alternative pattern. Both feed the same downstream slot-explosion logic.

### Tests

- Existing fixtures keep working (deprecation, not removal).
- New fixtures using `@@ name`.
- Negative: `@@ wrongname` in a template that declares only `[suggested]` produces a clear error pointing at the offending line.

### LSP impact

Diagnostics: slot name in source must match a declared slot of the enclosing template. Completion after `@@ ` suggests declared slot names. Hover on a slot marker shows its template's slot list.

### Documentation

User-guide §"Multi-slot templates" rewritten around the new syntax. Old syntax mentioned only in a "Deprecated" callout.

---

## F. `tender new` scaffolding family

### Goal

Dissolve the blank-page problem. Common authoring tasks become one command that emits a working stub.

### Subcommands

**`tender new template <name> [options]`**

Emits a template entry in `project.yaml` *and* a matching CSS stub in `styles.css`.

```
tender new template row \
  --columns 3fr/5fr \
  --baseline first \
  --params label,icon,speaker \
  --gap 8mm
```

Output added to `project.yaml`:

```yaml
templates:
  row:
    params: [label, icon, speaker]
    template: |
      <div class="row">
        <div class="col-l">
          {{#if speaker}}<span class="speaker-name">{{speaker}}</span>{{/if}}
          {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
          {{#if icon}}<img src="assets/images/{{icon}}.png" alt="" class="margin-icon">{{/if}}
        </div>
        <div class="col-r">{{{body}}}</div>
      </div>
```

Output added to `styles.css`:

```css
/* row template (added by `tender new template row`) */
.row {
  display: grid;
  grid-template-columns: 3fr 5fr;
  column-gap: 8mm;
  align-items: first baseline;
  margin-bottom: 1.5em;
}
```

**`tender new component <name> [options]`**

```
tender new component callout --variants warning,info --tag aside
```

Emits the component entry and a CSS stub with `:` selectors per variant.

**`tender new page-template <name> [options]`**

```
tender new page-template chapter-opener --size A5 --first-page-bare
```

Emits a `page-templates` entry with sensible defaults and the verso/recto + first-page boilerplate already filled in.

**`tender add layout <name>`**

Pulls a curated, working layout from a built-in library into the current project. Each layout is a small bundle that adds yaml + css and (optionally) appends a usage example to a designated location in `content.md`. Initial library:

- `two-col-baseline` — the `coastal-planet` row pattern.
- `cover-bottom-anchored` — flex column with `margin-top: auto` for a bottom element.
- `verso-recto-running-heads` — page template with mirror-margin + verso/recto headers.
- `multicol-with-figures` — three-column body with figure breakouts.
- `chapter-opener-bare-first-page` — first-page header suppression.

Layouts are stored as resources in `@tender/cli` (or `@tender/scaffolds` as a separate data package).

### Architecture

New module `packages/cli/src/scaffold/`:

```
scaffold/
  index.ts              (dispatch to subcommand)
  template.ts           (new template logic)
  component.ts          (new component logic)
  page-template.ts
  layouts/
    two-col-baseline/
      yaml.hbs          (Handlebars template producing yaml stub)
      css.hbs
      example.md.hbs
    cover-bottom-anchored/
      …
  yaml-merge.ts         (insert into existing project.yaml preserving comments)
  css-append.ts         (append to styles.css with a section comment)
```

The hardest part is `yaml-merge.ts`: editing user-edited YAML without losing comments or reformatting the user's existing content. Use a CST-preserving YAML library (`yaml` package's `Document` API) rather than parse/stringify round-tripping.

### Tests

- Each subcommand against an empty project produces a buildable result.
- Each subcommand against an existing project preserves user content and comments.
- `tender add layout two-col-baseline` followed by `tender build` produces non-empty output.
- Conflict cases: adding a template named `row` when `row` already exists prompts (in interactive mode) or fails (with `--force` to overwrite).

### LSP impact

None directly — but the LSP's completion can mention scaffolds: typing `:::r` in `content.md` when no `row` template exists could offer "Run `tender new template row` to create" as a quick-info entry. Stretch.

### Documentation

User-guide §"Scaffolds" lists each subcommand with a worked example. Each layout in the library gets a one-page doc showing what it does and the resulting source.

---

## G. Directive-call inspector in preview

### Goal

The preview UI's read-only counterpart to the LSP's hover. Click any rendered element → see which directive produced it, which template/component it resolved to, and which CSS rules apply.

### Behavior

In `tender preview`, an "Inspect" mode (toggle in the SPA chrome — keyboard shortcut `i`). When active, hovering over rendered elements highlights their directive bounds; clicking opens a side panel showing:

- **Source:** `content.md:42:1` — directive name and attrs, with a link that opens VS Code at the right line (via `vscode://` URL handler).
- **Resolved to:** `project.yaml:N` — the template/component definition, with link.
- **CSS rules applying:** list of selector/file/line entries, sorted by specificity. Each links to `styles.css:N`.
- **Computed key properties:** `display`, `font-size`, `line-height`, `column-gap`, `break-inside`, etc. — the print-relevant subset, not the whole computed-style dump.

### Source-mapping

Production parsing already knows directive source positions (the `positionPrefix` in error messages confirms this). Pipeline change: the parser tags each generated DOM node with `data-tender-source="content.md:42:1"` and `data-tender-template="row"` (gated by a `--with-source-map` build flag, on by default in preview, off in `tender build`).

The CSS-rule lookup uses `getMatchedCSSRules`-style introspection in the iframe (Chromium DevTools Protocol, exposed via Puppeteer in preview mode; or a smaller-scope JS inspection in the browser). Source-line mapping for CSS rules requires a parsed `styles.css` with line numbers — straightforward with `postcss`.

### UI

Side panel mounts in the SPA shell (next to the existing iframe). Three sections:

```
┌─ Inspector ──────────────────┐
│  :::row {label="45 min"}     │
│  content.md:42:1     [open]  │
│                              │
│  → template `row`            │
│  project.yaml:43     [open]  │
│                              │
│  CSS                         │
│  .row                        │
│    styles.css:98     [open]  │
│  .row.no-break               │
│    styles.css:88     [open]  │
│                              │
│  Computed                    │
│  display: grid               │
│  grid-template-columns: 3fr… │
│  align-items: first baseline │
└──────────────────────────────┘
```

### Architecture

- Source-map tagging in `packages/core/src/compose/` and `parse/`.
- Inspector logic in `packages/preview-ui/src/inspector/`.
- New API endpoint `/api/inspect?source=content.md:42:1` not strictly needed — the inspector reads everything from DOM data attributes + computed styles.
- VS Code URL scheme integration is a one-liner per "open" link.

### Tests

- Source-map attributes are present in preview output, absent in build output.
- Manual test: clicking a `:::row` in `coastal-planet` correctly identifies template + CSS rules.
- Inspector toggle persists across page navigation in the iframe.

### Out of scope

- Editing from the inspector. This is read-only, deliberately. Editing happens in VS Code, where the LSP is.

---

## H. Real `tender lint` warnings

### Goal

Convert lint from a binary "did the build break?" check into a useful refinement tool. Catches the things that *compile fine but indicate drift*.

### New checks

| Code | Severity | Description |
|---|---|---|
| `tender/unused-component` | warn | Component declared but never referenced in `content.md`. |
| `tender/unused-template` | warn | Template declared but never referenced. |
| `tender/orphan-css-class` | warn | Class in `styles.css` that no template/component emits and no inline HTML uses. |
| `tender/raw-html-with-known-class` | info | Inline HTML uses a class that matches a registered component — suggests using the directive form. |
| `tender/declared-slot-never-filled` | warn | Template declares slot `X` but no usage fills it (can be intentional, hence warn not error). |
| `tender/missing-asset` | error | `<img src="…">` or `assets/images/foo.png` that doesn't exist. |
| `tender/inconsistent-units` | info | Mixing `px` with `pt`/`mm` in print-critical properties. |
| `tender/duplicated-page-template-name` | error | Already caught by schema; surfaced explicitly. |

Each warning includes a Code Action where automatic — the orphan-CSS one suggests removal, the raw-HTML-with-known-class one suggests the directive form.

### Output format

```
$ tender lint my-doc
warning: project.yaml:34: component "yellow-tag" declared but never used [tender/unused-component]
warning: styles.css:208: class ".yellow-tag" defined but no element emits it [tender/orphan-css-class]
info:    content.md:24:1: raw HTML uses class "cover-spiral" — declared as template "cover-spiral" [tender/raw-html-with-known-class]
        suggestion: replace with `:::cover-spiral`

3 warnings, 1 info, 0 errors.
```

Exit code: non-zero only on errors. Warnings/info are informational. `--strict` flag promotes warnings to errors for CI.

### Architecture

`packages/core/src/lint/` (new submodule):

```
lint/
  index.ts          (run all checks, return Report)
  report.ts         (Report type with location, code, severity, message, suggestion)
  checks/
    unused.ts
    orphan-css.ts
    raw-html.ts
    missing-assets.ts
    units.ts
  css-analyze.ts    (postcss-based class extraction)
  html-analyze.ts   (cheerio-based class/asset extraction)
```

CLI command `tender lint` orchestrates: build the project up to but not including PDF render, collect all artifacts (parsed AST, generated HTML, project YAML, parsed CSS), run each check, format output.

### LSP impact

The LSP can run a subset of these checks (the cheap ones — unused, orphan, raw-html-with-known-class) on every buffer change, surfacing as VS Code diagnostics. The expensive ones (missing-assets requires filesystem access; full CSS analysis) stay in `tender lint` and run on demand or in CI.

### Tests

Each check has a positive fixture (rule fires) and a negative fixture (rule does not fire on legitimate cases). The `coastal-planet` fixture should produce zero warnings — it's the gold standard for "well-formed Tender project."

### Documentation

User-guide §"Validation" expanded to list every check with an example.

---

## I. Template composition (`extends`)

### Goal

Templates can extend other templates, factoring shared structure into a base. Removes the duplication between e.g. `row` and `ad-lib` (both currently re-declare the 3fr/5fr two-column grid in HTML *and* CSS).

### Behavior

A template can declare `extends: <name>`. The extending template inherits the parent's HTML scaffold and either fills the parent's slots or replaces them.

```yaml
templates:
  two-col:
    slots: [left, right]
    params: [no-break]
    template: |
      <div class="grid-2col{{#if no-break}} no-break{{/if}}">
        <div class="col-l">{{{left}}}</div>
        <div class="col-r">{{{right}}}</div>
      </div>

  row:
    extends: two-col
    params: [label, icon, speaker, no-break]
    slots:
      left: |
        {{#if speaker}}<span class="speaker-name">{{speaker}}</span>{{/if}}
        {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
        {{#if icon}}<img src="assets/images/{{icon}}.png" alt="" class="margin-icon">{{/if}}
      right: "{{{body}}}"
```

In `row`'s usage, the implicit `body` slot is mapped to the parent's `right`. `params` are merged (child wins on conflict).

### Source change

In `parse/templates.ts`, resolve `extends` chains at template-registration time (before any usage is parsed). Detect cycles. Cache the resolved template so each is composed once.

### CSS implication

The CSS-generation side benefits too. `compose/project-css.ts` can emit base rules for `two-col` once, and `row`/`ad-lib` only declare deltas. This addresses the density issue in `compose/project-css.ts:138-204` indirectly by giving authors a way to share structure at the source level.

### Tests

- Fixture: `row` extending `two-col` produces the same HTML as the current standalone `row` template.
- Cycle detection: `a extends b`, `b extends a` errors with both locations.
- Slot override: child fills parent's slot with content; parent's slot template is replaced.
- Param merge: child + parent params both available in the resolved template.

### LSP impact

Hover on a `row` shows the resolved template (post-composition) with provenance — "from `two-col`" annotations on inherited slots. Go-to-definition on `row` jumps to `row`'s declaration; with a follow-up "Show base" command jumping to `two-col`.

### Documentation

User-guide §"Template composition" with the worked `two-col` / `row` / `ad-lib` example showing how to refactor the current `coastal-planet` patterns.

### Why it lands later

Composition is a substantive language change with subtle semantics (slot mapping, param merge, override rules). Wants to land after the LSP can give good feedback on it. The current code works without it; this is an *enabling* feature, not a blocker.

---

## Implementation order

1. **E (LSP)** first. Everything else benefits from being demonstrable in-editor as it lands.
2. **A (named closes)** alongside the LSP — natural fit for the diagnostic system, small core change.
3. **D (slot syntax)** next — small, footgun-removing, gives the LSP another diagnostic to flex.
4. **C (inline shortcuts)** — somewhat independent, can land in parallel with D.
5. **B (implicit pages)** — bigger semantic change, deserves its own beat.
6. **F (`tender new`)** — substantial work but doesn't depend on any of the above.
7. **H (lint)** — naturally extends from the LSP's diagnostic infrastructure (much of the analysis is shared).
8. **I (template composition)** — substantive language change; benefits from the LSP being mature enough to surface composition behavior in hover/diagnostics.
9. **G (inspector)** — last, because it requires source-map plumbing through core and depends on understanding which inspector-target shapes are most useful (which the LSP work reveals).

A, D, C are deliberately small and backwards-compatible so they can ship as a minor version. B, F, I are bigger but additive. G and H build on infrastructure E established.

---

## Cross-reference: code-review issues

The initial code review surfaced issues outside the authoring-experience scope. Tracking them here so they aren't lost:

### Addressed by this plan

| Issue | Where addressed |
|---|---|
| `lint` is a stub (declared `result.warnings` never populated) | **H** rebuilds lint as a real check system. |
| Errors past schema-level degrade (Zod errors reach user verbatim) | **E** diagnostics provider gives precise authoring-time errors; **H** improves CLI error messages. |
| No template composition (raised in workflow assessment) | **I** introduces `extends`. |
| Density of `compose/project-css.ts:138-204` verso/recto branching | Indirectly improved by **I** (templates can share base CSS via composition); a fuller refactor stays separate. |
| The `coastal-planet/content.md:24` raw-HTML fallback to `<div class="cover-spiral">` (suggests directive seam edge case) | **E**'s diagnostics + **H**'s `tender/raw-html-with-known-class` check make this kind of drift visible. The underlying parser edge case wants its own investigation; tracked separately below. |

### Tracked separately (not part of this plan)

These deserve their own work but don't fit the authoring-experience theme. Recommend a small "code-quality and correctness" sweep as a separate beat:

| Issue | Type | Notes |
|---|---|---|
| Dead code: `packages/core/src/parse/markdown.ts`'s `parseMarkdown` is unused; only its own test references it. | Cleanup | Trivial. Remove or fold into `parseProject`. |
| Fragile heuristic in `packages/core/src/build.ts:24`: `/^\s*<div class="page"/` regex sniff to decide whether to wrap. | Refactor | Should be a structured signal from the parser ("doc opened with `:::page`"). |
| `compose/project-css.ts` density (298 lines; verso/recto + first-page-suppression branching at 138-204). | Refactor | A normalized intermediate `{first, rest, left, right}` per template before emitting CSS. Partly addressed by **I** but not fully. |
| Regex-based `inlineAssets` in `packages/render/src/inline-assets.ts:14` will mishandle multi-line or oddly-quoted `<img>` tags. | Correctness | Use a real HTML parser (cheerio is already a dep candidate via **H**). |
| No PDF golden tests; design doc acknowledges PDFs aren't pixel-diffed. | Test infra | A small set of fixture PDFs hashed (or pixel-diffed against reference renders) in CI. Catches regression of the kind that breaks `string-set` or `@page` rules silently. |
| Hyphenation/orphans/widows are emitted into CSS but no test verifies Chromium honors them. | Test infra | Companion to PDF golden tests — render a known-overflowing paragraph, assert it hyphenates. |
| Cold-start Chromium per `renderHtml` / `renderPdf` (~1-3s). Preview server pays this on every save. | Performance | Persistent browser instance reused across rebuilds; close on shutdown. Meaningfully speeds up the inner loop, which compounds with everything in this plan. |
| 60s render timeout is blunt; long docs may legitimately exceed it. | Robustness | Per-page or scaling timeout; configurable. |
| `--no-sandbox` documented only in code comments, not README. | Docs | One-line README callout under "Security considerations". |
| `coastal-planet/content.md:24` cover-spiral fallback to raw HTML — investigate why the directive form didn't work. | Investigation | Could be a slot-explosion edge case, a parsing bug, or an authoring choice. Worth reproducing and either fixing or documenting the limit. |

Recommend these be tackled in roughly that order: cleanup → correctness → test infra → performance → docs → investigations. The cleanup and correctness fixes are small and pay off across the rest of the plan. Test infrastructure should land *before* big language changes (B, I) so regressions are caught. Performance work compounds with the LSP-era authoring loop.

## Non-goals

- A WYSIWYG content editor. The editor is text + LSP, not a rich editor.
- Auto-fence-balancing or other "magic fixes" that hide structural mistakes.
- A wider directive vocabulary out of the box. The lever is making existing primitives better.
- Figma export integrations. The translation step is craft work; tokens-as-bridge is the realistic surface and is documentation, not code.
