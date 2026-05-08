# Tender — Design

A tool that turns plain prose plus project-defined styles, components, and page templates into print-ready PDFs and self-contained HTML, using web technologies (CSS Paged Media via Paged.js) as the layout engine.

`tender` is a working name; rename before v1 ship if desired.

## Goal

Build a general-purpose tool — usable across many future projects — for laying out text-based documents for print. The first real workload is an existing layout-rich Google Doc (a workshop playbook) currently mocked up in a single styled HTML file (`example.html` in this repo). The tool must reproduce that layout from a clean Markdown source plus a project configuration, and must remain expressive enough for other documents in future.

## Non-goals (v1)

Items deliberately deferred so v1 stays shippable:

- Multi-file content (chapters across files). v1 takes a single `content.md`; architecture leaves room for splitting later.
- In-source typographic markers: soft hyphens, NBSP, manual page-break markers in prose. All hyphenation/break control lives in `project.yaml`, `styles.css`, or template params.
- PDF/X / CMYK / commercial prepress. v1 produces RGB PDF suitable for digital print services.
- ePub or other reflowable output formats.
- In-browser editing. The preview is read-only; authoring happens in a code editor.
- Layout-warning system (orphaned headings, very-short last lines, bad column breaks). Architecture preserves the Paged.js `afterPageLayout` hook as the integration point; ships in v2.
- Theme/component packages distributed via npm. Components live per-project for now.
- JS-based component definitions. Templates in v1 are HTML with mustache-style placeholders, declared in YAML.

## High-level architecture

A Node + TypeScript monorepo with three packages.

```
project dir          parse              transform           render             export
-----------          -----              ---------           ------             ------
content.md     ─►  unified/remark  ─►  HTML + classes  ─►  Paged.js in    ─►  PDF (Puppeteer)
project.yaml         + directives        per yaml           headless       ─►  HTML (self-contained)
styles.css           plugin              vocab              Chromium
```

**Packages:**

- **`@tender/core`** — pure logic. Loads `project.yaml`, parses `content.md` via `unified`/`remark` with a custom directive plugin that resolves component and template names against the project vocab. Validates and emits HTML plus a manifest of warnings/errors. No browser dependency; trivially unit-testable.
- **`@tender/render`** — wraps Paged.js + Puppeteer. Takes the HTML from core plus the project's CSS and page-geometry settings, returns either a PDF buffer or a self-contained HTML string. Owns the only heavy dependency (Chromium).
- **`@tender/cli`** — user-facing entry. Subcommands: `init`, `build`, `preview`, `lint`. The future GUI will depend on `core` and `render` directly without going through the CLI.

This split keeps `core` testable without a browser, isolates Chromium in `render`, and makes the GUI roadmap straightforward.

## Project format

A project is a directory containing:

```
my-project/
  project.yaml      # vocab, page templates, typography, hyphenation
  styles.css        # visual styling
  content.md        # prose + layout invocations
  assets/
    images/
    fonts/
```

`tender init` scaffolds a project with sensible defaults: a `default` page template, a few common templates pre-declared (`row`, `spanning-row`), and a starter `styles.css`.

### `project.yaml`

Four top-level sections.

#### `page-templates`

Named page templates; each defines its own geometry and its own header/footer regions. There must always be a `default` template. Author applies non-default templates per page boundary in source.

```yaml
page-templates:
  default:
    size: A5                  # or [width, height] e.g. [148mm, 210mm]
    margin: { top: 18mm, bottom: 20mm, inner: 18mm, outer: 14mm }
    bleed: 3mm
    headers:
      left-page:  { left: "{page}", right: "{chapter}" }
      right-page: { left: "{title}", right: "{page}" }
    footers:
      center: "{page}"

  chapter-opener:
    size: A5
    margin: { top: 30mm, bottom: 20mm, inner: 18mm, outer: 14mm }
    bleed: 3mm
    headers: none             # suppressed on the opener page itself
    headers-rest: { left: "{chapter}", right: "{title}" }
    footers:
      center: "{page}"

  cover:
    size: A5
    margin: 0
    bleed: 3mm
    headers: none
    footers: none
```

Compilation rules (handled in `render`):

- Each named template emits a `@page <name> { … }` rule. Margins and size go in directly. Headers/footers map to `@top-left`, `@top-center`, `@top-right`, `@bottom-left`, `@bottom-center`, `@bottom-right` margin boxes with `content:` strings.
- `headers: none` (or `footers: none`) suppresses all margin boxes for that template.
- `left-page` / `right-page` keys produce `@page <name>:left { … }` / `@page <name>:right { … }` for verso/recto variants.
- `headers-rest` (paired with `headers: none`) produces `@page <name>:first { … }` (no boxes) and `@page <name> { … }` (boxes from `headers-rest`).
- Tokens in header/footer values: `{page}`, `{pages}`, `{title}`, `{chapter}` (last `h1`), `{section}` (last `h2`). Implemented via `string-set` and `running()`/`counter()` in CSS.
- `bleed` widens the page box and sets `marks: crop` if non-zero. v1 emits crop marks if bleed > 0, but does not produce a PDF/X-conformant file.

#### `typography`

Document-wide defaults. Emitted as base CSS the user can override in `styles.css`.

```yaml
typography:
  lang: en-GB                 # sets <html lang> for hyphenation dictionary
  hyphenation:
    enabled: true
    min-word-length: 6
    min-chars-before: 3
    min-chars-after: 3
    max-consecutive-hyphens: 2
  orphans: 2
  widows: 2
```

Maps to `hyphens: auto`, `hyphenate-limit-chars: <minword> <before> <after>`, `hyphenate-limit-lines: <max-consecutive>`, `orphans: N`, `widows: N` on the body, with `lang` set on `<html>`. Chromium honors these via Paged.js.

#### `components`

Simple components. Each declaration maps a name to a wrapping HTML element. The body inside the fenced div is parsed as Markdown and inserted as the element's children. Inline forms (`[text]{.name}`) work the same way.

```yaml
components:
  callout:
    tag: aside
    class: callout
    attrs: [variant]          # whitelist; values become data-* attributes
  pullquote:
    tag: blockquote
    class: pullquote
  stage-direction:
    tag: span
    class: stage-direction
    inline: true              # only valid as inline; rejected as block
```

Source `::: callout variant=warning` → `<aside class="callout" data-variant="warning">…parsed body…</aside>`.

#### `templates`

Parameterized HTML templates with named slots. Used for layout primitives that take multiple distinct content slots, or compose multiple HTML elements around a body. Mustache-style (Handlebars) syntax: `{{name}}` for attribute interpolation, `{{{slot}}}` for raw HTML insertion (slot bodies are pre-parsed and HTML-escaped by core), `{{#if name}}…{{/if}}` for conditional regions.

Single-slot template (default slot is `body`):

```yaml
templates:
  row:
    params: [label, icon, speaker, no-break]
    template: |
      <div class="row{{#if no-break}} no-break{{/if}}">
        <div class="col-l">
          {{#if speaker}}<span class="speaker-name">{{speaker}}</span>{{/if}}
          {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
          {{#if icon}}<img src="assets/images/{{icon}}.png" class="margin-icon" alt="">{{/if}}
        </div>
        <div class="col-r">{{{body}}}</div>
      </div>
```

Source:

```
::: row label="Approx 45 minutes" icon=clock no-break
#### Stage 1. Welcome, Introductions

The welcome sets a friendly tone…
:::
```

Multi-slot template:

```yaml
templates:
  ad-lib:
    slots: [suggested]        # body is implicit if no `slots:` declared
    template: |
      <div class="ad-lib no-break">
        <div class="ad-lib__suggested">{{{suggested}}}</div>
        <div class="ad-lib__box"><span class="ad-lib__label">your version</span></div>
      </div>
```

Source uses `--- slot-name ---` sentinels to delimit slots within the fence:

```
::: ad-lib
--- suggested ---
"Before we begin, I want to name a few things…"
:::
```

A built-in `page` template ships with the scaffold, used to apply page templates at boundaries:

```
::: page template=chapter-opener
## Stage 1. Welcome
…
:::
```

It compiles to `<div class="page" data-page-template="chapter-opener">…</div>`. The render layer also emits a matching `.page[data-page-template="chapter-opener"] { page: chapter-opener; }` rule, which Paged.js uses to break to that named page.

### `styles.css`

Plain CSS, written by the project author. Targets the classes declared in `components` and `templates` plus standard Markdown-derived elements. CSS Paged Media features (`@page`, `break-before`, `break-inside`, `string-set`, `running()`) are available; the tool doesn't wrap them.

The render layer prepends a generated `_project.css` (page-template `@page` rules + typography defaults) before user CSS, so user styles can override generated defaults without `!important`.

### `content.md`

CommonMark (via `remark-parse`) plus Pandoc-style fenced divs (via a custom remark plugin). Component and template names are resolved at parse time against `project.yaml`; unknown names are errors with line numbers.

## Component & template model

Two declaration kinds, summarized:

- **Components** — name → wrapping HTML element. Body is parsed Markdown. Trivial case.
- **Templates** — name → HTML template with named slots and parameters. Slot contents are parsed Markdown, then inserted as HTML into the template.

Both are validated at project-load time:

- Unknown name → error with line/column.
- Unknown attr/param → warning.
- Missing required slot → error.
- Template syntax error in YAML → error at load, before any content is parsed.

Inline components are supported (`[text]{.classname}`); inline templates are not (no use case yet).

## Rendering

Pipeline inside `@tender/render`:

1. **Compose HTML.** Wrap the parsed body in a minimal HTML shell that loads `_project.css` (generated), `styles.css` (user), the Paged.js polyfill, and any fonts declared in `project.yaml`'s `fonts:` list (WOFF2, `@font-face` rules emitted into `_project.css`).
2. **Run Paged.js in headless Chromium** via Puppeteer. Paged.js polyfills CSS Paged Media; the resulting flowed DOM is paginated.
3. **Export.**
   - **PDF:** `puppeteer.page.pdf({ printBackground: true, width, height, margin: 0, preferCSSPageSize: true })`. Bleed is part of the CSS page size; crop marks (if bleed > 0) are emitted by Paged.js via `marks: crop`.
   - **HTML:** serialize the post-Paged.js DOM, inline `styles.css`/`_project.css`, base64-inline images and fonts. Result is a single self-contained file.

### Break and hyphenation control

Three layers, all CSS-based:

1. **Project-wide defaults** from `project.yaml` → emitted into `_project.css` as base rules.
2. **Per-component rules** in `styles.css` → e.g. `.callout { break-inside: avoid; }`.
3. **Per-instance via template params** → `row` template's `no-break` flag adds `no-break` class. The author's escape hatch without exposing CSS knobs to prose.

No in-source typographic markers in v1.

### Asset handling

- Image paths in `content.md` and template parameters are resolved relative to the project dir.
- For PDF, Chromium loads images off disk.
- For HTML, images are base64-inlined.
- Fonts: declared in `project.yaml`'s `fonts:` block (filename, family, weight, style); WOFF2 only.

## CLI

```
tender init <dir>           # scaffold a new project
tender build [<dir>]        # render PDF + HTML to ./out/
tender preview [<dir>]      # local server :3000, watch files, live-reload
tender lint [<dir>]         # parse-only; report warnings/errors; exit non-zero on errors
```

Common flags: `--out <path>`, `--pdf-only`, `--html-only`, `--port <n>`, `--quiet`, `--verbose`. Default project dir is `.`.

`tender init` writes a minimal but useful starter:

- `project.yaml` with `default` and `chapter-opener` page templates, `row`/`spanning-row`/`page` templates, and a couple of common simple components.
- `styles.css` with base styles and class hooks for the included templates.
- `content.md` with a few example pages demonstrating page-template application, rows, and a callout.

## Preview server

Express serves the rendered HTML at `/`. Chokidar watches `project.yaml`, `styles.css`, `content.md`, and `assets/`. On change, re-run core + render (HTML mode), push a websocket message; the page reloads. Full reload, not HMR — pagination must recompute.

The preview is the same Paged.js-flowed DOM as the HTML export, so what the user sees is what they get. PDF export is on-demand: a `Build PDF` button on the preview page (calls a server route that runs `render` in PDF mode), or `tender build` from the CLI.

## Error handling

Three classes:

1. **Authoring errors** (unknown component, missing slot, malformed YAML, unresolved asset path) — caught in `core`. CLI exits non-zero with file + line. Preview server displays an error overlay in the browser instead of the stale rendered output.
2. **Render errors** (Chromium launch fails, Paged.js throws, font 404) — caught in `render`. One-line summary plus suggestion; full stack with `--verbose`.
3. **Layout warnings** (orphans, bad breaks, empty regions) — *not implemented in v1*. The Paged.js `afterPageLayout` hook is reserved as the integration point.

## Testing

Three layers:

1. **Unit (`core`)** — Vitest. Each parser plugin (component dispatch, template expansion, slot splitting, page-template application) gets table-driven tests: input Markdown → expected HTML AST.
2. **Integration (`core` + `render` HTML mode)** — golden-file snapshots. A small set of fixture projects, including a stripped-down reconstruction of `example.html` as `content.md` + `project.yaml` + `styles.css`, render to HTML; output diffed against checked-in snapshots. Updates explicit (`vitest -u`).
3. **PDF smoke tests** — for each fixture, render PDF and assert: page count in expected range, valid PDF header, embedded font count > 0. No pixel-diffing; too brittle across Chromium versions.

CI runs all three. Puppeteer's bundled Chromium is used; standard CI patterns apply.

## Distribution

- Published to npm as a single CLI package; `npm install -g tender`.
- Puppeteer pulls Chromium on install.
- Optional Docker image for CI environments where bundled Chromium is awkward.

## Roadmap beyond v1

Captured as deferrals so the v1 architecture preserves the seams:

- **Layout warnings** via Paged.js `afterPageLayout` hook (orphaned headings, very-short last lines, empty boxes).
- **Multi-file content** with explicit ordering and cross-file numbering/cross-references.
- **In-source typographic markers** (soft hyphens, NBSP) if real workloads prove project-level control insufficient.
- **PDF/X / CMYK / prepress** for commercial print, likely via a Ghostscript post-process step.
- **Bigger GUI** — moves beyond live-preview-only toward an editing surface; native packaging (Tauri or Electron) decided then.
- **Component packages** distributed via npm so themes and shared component sets can be installed across projects.
- **JS-based component definitions** for cases that templates can't express (computed defaults, runtime logic).
