# Tender User Guide

Tender turns a project directory of plain text and CSS into print-ready PDFs. This guide covers the source conventions you'll use day-to-day; CLI commands are at the end.

## Mental model

A Tender project is a directory with three files, a components folder, and an assets folder:

```
my-doc/
  project.yaml      # globals: page templates, typography, fonts, inline shortcuts
  styles.css        # presentation: design tokens, layout, typography
  content.md        # the prose, with components invoked by name
  components/
    row.tender      # one .tender file per component, frontmatter + template + style + palette
    callout.tender
    ...
  assets/
    images/
    fonts/
```

The split is deliberate:

- **`project.yaml`** declares your **vocabulary** (page templates, inline shortcuts) and **global settings** (page geometry, typography, hyphenation, fonts). It's the "what".
- **`styles.css`** styles the elements — design tokens, layout grids, base typography. It's the "how it looks".
- **`content.md`** is the prose, with named components invoked via tag syntax. It's the "what it says".
- **`components/*.tender`** are single-file components — frontmatter declaring params/slots, a Handlebars template, optional `<style>` and `<palette>` blocks. Each component lives in one file alongside its CSS.

Authoring loop: edit any of the four sources, watch the live preview update, build to PDF when ready.

```
tender preview my-doc      # one terminal — leave running
# edit files in another window
tender build my-doc        # when satisfied
```

---

## Source conventions

### Pages

Every page begins with a `=== page` marker on its own line. Content before the first marker is wrapped in an implicit default page.

```
=== page

# This is the start of a page.

A paragraph on this page.

=== page

# A new page.

Content on the next page.
```

To use a non-default page template (different geometry, different headers/footers):

```
=== page{template=cover}

# Title page

=== page

# Body
```

`template=name` matches an entry in `project.yaml`'s `page-templates:` block.

You can also use explicit `<page>` tags when you need to wrap a region with attributes that aren't ergonomic as marker attributes. The two forms are equivalent and can mix; prefer markers in prose.

```
<page template="chapter-opener">

# Chapter 4

</page>
```

### Block components

A **block component** wraps any content into a styled block. Define one as `components/callout.tender`:

```
---
tag: aside
class: callout
params: [variant]
---
```

(That's the simplest case — a wrapper component. See "Single-file `.tender` components" below for the full format.)

Use it in `content.md` with closed-pair tag syntax:

```
<callout variant="warning">

Watch your step.

</callout>
```

This compiles to `<aside class="callout" data-variant="warning">…</aside>`. Whatever Markdown you put inside parses normally — paragraphs, lists, emphasis, sub-components.

The `params` list is a whitelist. Each declared attribute given in source becomes a `data-*` attribute on the rendered HTML, which you target in CSS:

```css
.callout[data-variant="warning"] { border-left: 3px solid red; }
.callout[data-variant="info"]    { border-left: 3px solid steelblue; }
```

### Inline components

Same idea but for marking up a span of text inside a paragraph. Declare with `inline: true`:

```
---
tag: span
class: stage-direction
inline: true
---
```

Use inline in `content.md`:

```
Welcome everyone. <stage-direction>The facilitator looks around the room.</stage-direction> We're so glad you're here.
```

`inline: true` makes the component reject block-level use; without it, a component can be used either way.

### Inline shortcuts (single-character marks)

For inline components used heavily in prose, declare a single-character shortcut in `project.yaml`:

```yaml
inline-shortcuts:
  "@": speaker-name
  "|": stage-direction
```

Then in `content.md`:

```
@Facilitator A@ |She gestures to the room.| Welcome everyone.
```

becomes

```
<speaker-name>Facilitator A</speaker-name> <stage-direction>She gestures to the room.</stage-direction> Welcome everyone.
```

Allowed shortcut characters: `@`, `%`, `|`, `§`. Other characters are rejected at config-load time. The mapped component must exist and be `inline: true`.

Same-line only: a shortcut span can't cross a newline. Backslash escapes `\@text\@` pass through as literal `@text@`. Inside fenced code blocks, inline code spans, HTML comments, and tag attribute values, shortcut characters are left alone.

### Block templates with parameters and slots

When a component is more than a wrapper — when it takes parameters or has multiple content regions — declare it as a block template. The frontmatter declares params/slots and the body is the Handlebars template.

`components/row.tender`:

```
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
```

Use it:

```
<row label="45 min" icon=clock>

#### Welcome and introductions

The opening sets a friendly tone and connects participants to the day.

</row>
```

Parameters can be omitted. When `label` isn't given, the `{{#if label}}` block disappears. The triple-mustache `{{{body}}}` inserts the parsed body HTML; the double-mustache `{{label}}` inserts attribute values with HTML escaping.

#### Multi-slot templates

When a template needs multiple content regions, declare named slots and use `@@ slotname` markers in the body:

```
---
slots: [suggested]
---

<div class="ad-lib">
  <div class="ad-lib__suggested">{{{suggested}}}</div>
  <div class="ad-lib__box">
    <span class="ad-lib__label">your version</span>
  </div>
</div>
```

In `content.md`:

```
<ad-lib>

@@ suggested

"Before we begin, I want to name a few things about where we are…"

</ad-lib>
```

Each slot's content is parsed as Markdown.

### Inline HTML

Sometimes Markdown can't express what you need — a `<br>` inside a span, a CSS-grid layout for a cover page. Just use raw HTML:

```
<div class="cover-tags">
  <div><span class="yellow-tag">A time-travel playbook for<br>inspiring coastal communities</span></div>
  <div><span class="yellow-tag">By Ruth Catlow and Ann Light</span></div>
</div>
```

Tender passes raw HTML through. Reach for it sparingly — anything you find yourself repeating should become a component.

### Headings, lists, paragraphs, emphasis

These are vanilla CommonMark:

```
# H1
## H2
### H3
#### H4

A paragraph with *emphasis*, **strong**, `code`, and a [link](https://example.com).

- List item one
- List item two
  - Nested

1. Ordered list
2. Second item

> A blockquote.
```

These render to standard HTML elements; you style them in `styles.css`.

---

## Single-file `.tender` components

Each component lives in one file under `components/`. The format has up to four sections:

```
---
<frontmatter as YAML>
---

<template HTML with Handlebars>

<style>
<CSS rules>
</style>

<palette>
<palette as YAML>
</palette>
```

Only the template is required (or just the frontmatter, for a wrapper). Everything else is optional.

### Frontmatter fields

| Field | Type | Notes |
|---|---|---|
| `tag` | string | HTML element name. Required for **wrapper** components. |
| `class` | string | CSS class added to the wrapper. |
| `params` | string list | Whitelisted attribute names. For wrappers, each becomes `data-name`. For block templates, each is a Handlebars variable. |
| `slots` | string list | Named content regions filled with `@@ slotname` markers. |
| `inline` | boolean | If `true`, only valid inline. Wrappers only. |
| `template` | (auto) | Block-template body — anything between frontmatter and `<style>`/`<palette>` is the template. |

A component is a **wrapper** when its frontmatter has `tag` and no template body. A component is a **block template** when its body is non-empty Handlebars HTML. Both flavors can declare `params` (and block templates can also have `slots`).

### `<style>` block

CSS rules scoped to the project's `_components.css` stylesheet (loaded after `_project.css`, before `styles.css`). Useful for keeping component-specific styles next to the template.

```
<style>
.row {
  display: grid;
  grid-template-columns: 3fr 5fr;
  column-gap: 8mm;
}
</style>
```

The `<style>` opener and `</style>` closer must be at column 0. Inner content can include any text including raw `</style>`-shaped strings inside CSS values.

### `<palette>` block

Optional examples shown in the Palette tab in `tender preview`. Doesn't affect PDF/HTML output. Same shape as the legacy `palette:` YAML block — see "Palette" below.

```
<palette>
params: { label: "45 min" }
body: "Sample row content."
variants:
  - params: { label: "20 min", icon: clock }
    body: "A second example."
</palette>
```

---

## `project.yaml` reference

A complete project file looks like this:

```yaml
page-templates:
  default:
    size: A5
    margin: { top: 18mm, bottom: 20mm, inner: 18mm, outer: 14mm }
    headers:
      left: "{chapter}"
      right: "{page}"
    footers:
      center: "{page}"
  chapter-opener:
    size: A5
    margin: { top: 30mm, bottom: 20mm, inner: 18mm, outer: 14mm }
    headers: none
    headers-rest:
      left: "{chapter}"
      right: "{page}"

typography:
  lang: en-GB
  hyphenation:
    enabled: true
    min-word-length: 6
    min-chars-before: 3
    min-chars-after: 3
    max-consecutive-hyphens: 2
  orphans: 2
  widows: 2

fonts:
  - family: Display
    file: MackinacPro-Book.woff2
    weight: 400
    style: normal

inline-shortcuts:
  "@": speaker-name
  "|": stage-direction

clean:
  typography: smart
```

### `page-templates`

Every project must have a `default` page template. Declare any number of additional ones; reference them in source via `=== page{template=name}`.

| Field | Type | Notes |
|---|---|---|
| `size` | `A4`, `A5`, `A6`, `Letter`, `Legal`, or `[width, height]` (e.g. `[148mm, 210mm]`) | |
| `margin` | object with `top`/`bottom`/`inner`/`outer` (or `left`/`right`), or `0` | |
| `bleed` | length string (e.g. `3mm`) | Optional; expands page box for crop marks. |
| `headers` | object, `"none"`, or verso/recto object | See below. |
| `footers` | same as headers | |
| `headers-rest` | object | Used with `headers: none` to suppress on the *first* page only. |
| `footers-rest` | same | |

**Header/footer regions.** Each header/footer is an object with up to three fields: `left`, `center`, `right`. Each value is either a literal string or a single token.

```yaml
headers:
  left: "{chapter}"
  center: "Chapter notes"
  right: "{page}"
```

Available tokens (use exactly one per region — mixed token+literal isn't supported in v1):

| Token | Expands to |
|---|---|
| `{page}` | Current page number |
| `{pages}` | Total page count |
| `{title}` | Document title (folder name) |
| `{chapter}` | Most recent `<h1>` text |
| `{section}` | Most recent `<h2>` text |

**Verso/recto variants** — different headers on left and right pages:

```yaml
headers:
  left-page:  { left: "{page}", right: "{chapter}" }
  right-page: { left: "{chapter}", right: "{page}" }
```

**First-page suppression** — typical for chapter openers where you don't want the running head on the page that already has the chapter title:

```yaml
chapter-opener:
  headers: none
  headers-rest:
    left: "{chapter}"
    right: "{page}"
```

The first page of any `chapter-opener` template gets no header; subsequent pages of the same template get the `headers-rest` values.

### `typography`

| Field | Default | Notes |
|---|---|---|
| `lang` | `en` | Sets `<html lang>`; controls hyphenation dictionary in Chromium. |
| `hyphenation.enabled` | `true` | |
| `hyphenation.min-word-length` | `5` | |
| `hyphenation.min-chars-before` | `2` | |
| `hyphenation.min-chars-after` | `2` | |
| `hyphenation.max-consecutive-hyphens` | (unlimited) | |
| `orphans` | (browser default) | Min lines kept at the bottom of a page. |
| `widows` | (browser default) | Min lines kept at the top of a page. |

### `fonts`

A list of `@font-face` rules. WOFF2 only.

```yaml
fonts:
  - family: Display
    file: MackinacPro-Book.woff2     # in assets/fonts/
    weight: 400
    style: normal
  - family: Display
    file: MackinacPro-BookItalic.woff2
    weight: 400
    style: italic
```

Use the families in `styles.css`:

```css
:root { --font-display: 'Display', Georgia, serif; }
h1 { font-family: var(--font-display); }
```

### `inline-shortcuts`

Map a single-character mark to an inline component. The character must be one of `@`, `%`, `|`, `§`. The mapped component must exist and have `inline: true`.

```yaml
inline-shortcuts:
  "@": speaker-name
  "|": stage-direction
```

### `clean`

Settings for `tender clean`.

| Field | Default | Notes |
|---|---|---|
| `typography` | `off` | Set to `smart` to enable curly-quote / em-dash / ellipsis conversion in `tender clean`. |

### Palette overrides

Each component's `<palette>` block (or the legacy palette: object inside frontmatter) provides example renders for the Palette tab in `tender preview`. Doesn't affect PDF/HTML output.

| Field | Notes |
|---|---|
| `attrs` / `params` | Object of attribute/param values for the default render. |
| `body` | Body content for the default render. |
| `slots` | Object of slot contents (for templates with named slots). |
| `variants` | List of variant objects (each can override any of the above), shown as additional renders in the tile. |

---

## `styles.css` conventions

`styles.css` is plain CSS. A few conventions worth knowing:

### CSS custom properties for tokens

Define design tokens once at `:root`, reference them throughout. Makes themes easy.

```css
:root {
  --font-display: 'Display', Georgia, serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --color-ink: #1a1a1a;
  --color-accent: #FFE600;
  --size-body: 11pt;
  --leading-body: 1.55;
}

body {
  font-family: var(--font-body);
  font-size: var(--size-body);
  line-height: var(--leading-body);
  color: var(--color-ink);
}
```

### Print units

Use `pt`, `mm`, `cm`, `in` for type and spacing where the printed dimension matters; use `em` for proportional spacing. Avoid `px` for anything print-critical.

```css
h1 { font-size: 24pt; margin-bottom: 6mm; }
p  { margin-bottom: 0.6em; }
```

### CSS Paged Media features

Tender exposes the full CSS Paged Media spec. The most useful properties:

```css
.callout       { break-inside: avoid; }   /* don't split this block across pages */
.no-break      { break-inside: avoid; }
h1             { break-before: page; }    /* always start an H1 on a new page */
h2             { break-after: avoid; }    /* never end a page with an H2 */
.figure        { break-after: avoid; }    /* keep with following caption */
p              { orphans: 3; widows: 3; } /* min 3 lines each end of page */
```

### Targeting page templates from CSS

A `=== page{template=cover}` becomes `<div class="page" data-page-template="cover">`, which you can target:

```css
.page[data-page-template="cover"] {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.page[data-page-template="cover"] .cover-spiral {
  margin-top: auto;       /* push to bottom of page */
}
```

This pattern is how you implement bottom-anchored content, full-bleed covers, multi-column layouts on specific page templates.

### Cascade order

Three CSS layers load in order:

1. `_project.css` — generated from `project.yaml`'s `page-templates` and `typography` (carries `@page` rules and base typography).
2. `_components.css` — concatenated `<style>` blocks from every component's `.tender` file, in alphabetical-by-name order.
3. `styles.css` — your project-wide overrides and design tokens.

You should rarely need `!important`. Source order does the work.

---

## Assets

### Images

Place in `assets/images/`. Reference from Markdown:

```markdown
![A spiral diagram](assets/images/spiral.png)
```

Or as raw HTML:

```html
<img src="assets/images/spiral.png" alt="">
```

Or via a template:

```
---
params: [icon]
---

<img src="assets/images/{{icon}}.png">
```

PNG, JPEG, GIF, SVG, WebP all work. In the standalone HTML output, images get base64-inlined; in the PDF, Chromium reads them off disk.

### Fonts

WOFF2, in `assets/fonts/`. Declare in `project.yaml`'s `fonts:` block — that emits the `@font-face` rules. You then use the font family in `styles.css` like any other.

---

## Onboarding from existing prose

If you're starting from a manuscript in Google Docs, Word, Pages, or anywhere else, the typical workflow is:

```
tender init my-doc                  # scaffold the project
# open my-doc/content.md in your editor
# paste your prose from Google Docs / Word / Pages
tender clean my-doc/content.md      # sanitise paste artifacts
tender preview my-doc               # see it live; start authoring
```

`tender clean` strips the dirty bits a paste typically introduces: BOMs, zero-width spaces, soft hyphens, NBSPs in prose, mixed line endings, trailing whitespace, runs of blank lines. Optionally with `--typography`, it also converts straight quotes to curly, `--` to em-dashes, and `...` to ellipses.

Pasted from a tool that supports it, **"Copy as Markdown"** (Google Docs has this since 2024) is worth using — your headings, lists, bold, and italic survive the clipboard. Otherwise plain text arrives, and you'll add structure progressively in `content.md`.

Once content is sanitised, the authoring loop is regular Tender: edit `content.md`, watch `tender preview` reload, wrap content in `<row>`/`<callout>`/etc. as the structure becomes clear.

---

## Authoring patterns

### A two-column layout (margin column + body)

The pattern from the `coastal-planet-tags` reference fixture. Margin column carries labels, icons, speaker names; body column has the prose.

`components/row.tender`:
```
---
params: [label, icon, speaker, no-break]
---

<div class="row{{#if no-break}} no-break{{/if}}">
  <div class="col-l">
    {{#if speaker}}<span class="speaker-name">{{speaker}}</span>{{/if}}
    {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
    {{#if icon}}<img src="assets/images/{{icon}}.png" class="margin-icon" alt="">{{/if}}
  </div>
  <div class="col-r">{{{body}}}</div>
</div>
```

`styles.css`:
```css
.row {
  display: grid;
  grid-template-columns: 3fr 5fr;
  column-gap: 8mm;
  align-items: first baseline;
  margin-bottom: 1.5em;
}
```

Use:
```
<row label="45 min" icon=clock>

#### Stage 1. Welcome

The welcome sets a friendly tone…

</row>
```

### A bottom-anchored cover

Cover content flows top-down; the spiral drops to the bottom-left.

`project.yaml`:
```yaml
page-templates:
  cover:
    size: A4
    margin: { top: 12mm, bottom: 12mm, inner: 12mm, outer: 12mm }
    headers: none
    footers: none
```

`styles.css`:
```css
.page[data-page-template="cover"] {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.cover-spiral { margin-top: auto; }
.cover-spiral img { width: 25%; }
```

`content.md`:
```
=== page{template=cover}

# This Coastal Planet

…cover content…

<cover-spiral />
```

### Keeping a block together across page breaks

```css
.callout      { break-inside: avoid; }
.row.no-break { break-inside: avoid; }
```

In source, a row template that takes a `no-break` flag:
```
---
params: [label, no-break]
---

<div class="row{{#if no-break}} no-break{{/if}}">…</div>
```

```
<row label="Note" no-break=true>

This whole block stays on one page.

</row>
```

### A chapter opener with a different first page

```yaml
page-templates:
  chapter-opener:
    size: A5
    margin: { top: 50mm, bottom: 20mm, inner: 18mm, outer: 14mm }
    headers: none
    headers-rest:
      left: "{chapter}"
      right: "{page}"
    footers:
      center: "{page}"
```

```
=== page{template=chapter-opener}

# Chapter 4

The chapter opens here. The running head is suppressed on this page,
and if the chapter overflows to subsequent pages those will get
"Chapter 4 / 17" style running heads automatically.
```

---

## Validation

Run `tender lint my-doc` before building or committing. v1 checks:

| Code | Severity | What |
|---|---|---|
| `tender/unused-component` | warning | A `components/foo.tender` exists but no `<foo>` invocation in content. |
| `tender/unknown-component` | error | `content.md` references a component name that's not declared. |
| `tender/missing-asset` | error | A relative `src=`/`href=` reference points at a file that doesn't exist. |
| `tender/deprecated-syntax` | info | Old-style `:::name` directives or `--- slot ---` markers — suggests `<name>` and `@@ slot`. |

Flags:

- `--strict` promotes warnings to errors (CI gating).
- `--json` emits findings as JSON for editor integrations.

Exit code is non-zero on errors (or any warnings under `--strict`).

```
$ tender lint my-doc
warning: components/yellow-tag.tender:1: Component "yellow-tag" is declared but never used. [tender/unused-component]
error  : content.md:42:1: Unknown component "callout-warning". [tender/unknown-component]

1 errors, 1 warnings, 0 info.
```

---

## CLI reference

### `tender init <dir>`

Scaffolds a new project from the default starter. Refuses if `<dir>` is non-empty unless `--force`.

```
tender init my-doc
tender init my-doc --force
```

### `tender build [dir]`

Renders to `dir/out/` (or `--out <path>`). Default `dir` is `.`.

```
tender build my-doc
tender build my-doc --out ~/Desktop
tender build my-doc --pdf-only
tender build my-doc --html-only
```

### `tender preview [dir]`

Live-reloading HTML preview. Edits to `project.yaml`, `styles.css`, `content.md`, any `.tender` component, or any file in `assets/` trigger a rebuild and browser refresh.

```
tender preview my-doc
tender preview my-doc --port 3993
tender preview my-doc --host 0.0.0.0          # expose on LAN/Tailscale
```

The preview shows pages as printed sheets (white background, drop shadow, page numbers, margin guides). Build errors surface in the terminal and as a browser overlay; the server stays up and recovers when you fix the error. Stop with Ctrl-C.

### `tender lint [dir]`

Validates a project and surfaces structural issues. See "Validation" above.

```
tender lint my-doc
tender lint my-doc --strict     # warnings → errors
tender lint my-doc --json       # machine-readable
```

### `tender clean [path]`

Sanitises a Markdown file: strips paste artifacts (BOM, zero-width chars, soft hyphens, NBSPs in prose, mixed line endings, trailing whitespace, redundant blank lines). Optionally with `--typography`, applies smart quotes / dashes / ellipses.

```
tender clean my-doc/content.md           # interactive: prompts before writing
tender clean --check my-doc/content.md   # exit non-zero if changes pending
tender clean --yes my-doc/content.md     # skip prompt
tender clean --typography my-doc/content.md
```

Set `clean.typography: smart` in `project.yaml` to make `--typography` the default for that project.

---

## Security considerations

Tender renders via headless Chromium, launched with `--no-sandbox`. The flag is required on Linux hosts that disable unprivileged user namespaces (most CI environments fall into this category). The tradeoff: the rendering process runs without Chromium's normal sandbox isolation.

This is acceptable for the typical Tender use case — rendering local source files you author yourself. The risk surface only matters if you pipe **untrusted** content (Markdown, YAML, raw HTML, or images) into the build, in which case a malicious document could include script content that runs in the headless browser without sandboxing. Hosted-service deployments should consider running Tender in a separate container or VM and reviewing input sanitization.

## What's not in v1

- **Single content file.** Multi-file content (chapters across files, with cross-references and continuous numbering) is a v2 item.
- **No layout-warning system.** Bad column breaks, very-short last lines, orphans the engine couldn't fix — none flagged automatically. Your eye is the linter; the preview is the tool.
- **No mixed token + literal in headers/footers.** `"Page {page}"` will throw an error; use either a single token or a single literal per region.
- **RGB only.** No CMYK, PDF/X, or commercial prepress conformance.
- **No ePub or reflowable formats.** Tender is print-first; the standalone HTML output is a portable mirror of the PDF, not a separate web target.

## Appendix: emergency escape hatch

If you suspect a regression in the new tag-syntax pipeline, set `TENDER_TAG_SYNTAX=0` to disable preprocessing. Source falls back to the legacy `:::name` directive parser. This exists for bisecting; the legacy path will be removed once `tender migrate` lands and projects are converted.

For the design rationale and roadmap, see [`docs/plans/2026-05-08-tender-authoring-experience-plan.md`](plans/2026-05-08-tender-authoring-experience-plan.md).
