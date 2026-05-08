# Tender User Guide

Tender turns a project directory of plain text and CSS into print-ready PDFs. This guide covers the source conventions you'll use day-to-day; CLI commands are at the end.

## Mental model

A Tender project is three files plus an assets folder:

```
my-doc/
  project.yaml      # what your document is and what components exist
  styles.css        # how things look
  content.md        # the prose
  assets/
    images/
    fonts/
```

The split is deliberate:

- **`project.yaml`** declares your **vocabulary** (the names of page templates, block components, inline spans, layout templates) and **global settings** (page size, margins, typography, hyphenation). It's the "what".
- **`styles.css`** styles the elements. It's the "how it looks".
- **`content.md`** is just the prose, with named components invoked by name. It's the "what it says".

Authoring loop: edit `content.md` (or any of the three), watch the live preview update, build to PDF when ready.

```
tender preview my-doc      # one terminal — leave running
# edit files in another window
tender build my-doc        # when satisfied
```

---

## Source conventions

### Pages

Every page in your output starts with `::::page`. Open with four colons, write content, close with `::::`.

```
::::page

# This is the start of a page.

A paragraph on this page.

::::
```

To apply a non-default page template (different geometry, different headers/footers):

```
::::page{template=cover}

# Title page

::::
```

`template=name` matches a named entry in `project.yaml`'s `page-templates` block.

**Why four colons?** Tender uses Pandoc-style directives (`:::name`) for everything else. The outer fence has to use *more* colons than anything nested inside it. Since most directives use three, page wrappers use four. If you ever nest a `::::page` inside something using four colons, escalate to five.

### Forcing a page break

To break to a new page mid-document, simply close one page and open the next:

```
::::page

First page content.

::::

::::page

Second page content.

::::
```

A break can land mid-section by closing the current page directly after the line you want, then re-opening with the continuation:

```
:::row{speaker="Facilitator A" icon=speaker}

Welcome everyone. Today we're going to travel through time together.

:::

::::

::::page

:::row{speaker="Facilitator B" icon=speaker}

And I'm here to make sure we have everything we need along the way.

:::
```

There is no `<!-- pagebreak -->` style marker in v1. Page breaks are always expressed as page boundaries.

### Block components

A **block component** wraps any content into a styled block. Define one in `project.yaml`:

```yaml
components:
  callout:
    tag: aside
    class: callout
    attrs: [variant]
```

Use it with three colons:

```
:::callout{variant=warning}

Watch your step.

:::
```

This compiles to `<aside class="callout" data-variant="warning">…</aside>`. Whatever Markdown you put inside parses normally — paragraphs, lists, emphasis, sub-components.

The `attrs` list is a whitelist. Each attribute given in source becomes a `data-*` attribute on the rendered HTML, which you target in CSS:

```css
.callout[data-variant="warning"] { border-left: 3px solid red; }
.callout[data-variant="info"]    { border-left: 3px solid steelblue; }
```

### Inline components

Same idea but inline, for marking up a span of text inside a paragraph:

```yaml
components:
  stage-direction:
    tag: span
    class: stage-direction
    inline: true
```

In source, single colons + bracketed content:

```
Welcome everyone. :stage-direction[The facilitator looks around the room.] We're so glad you're here.
```

`inline: true` makes the component reject block-level use; without it, a component can be used either way.

### Templates (layouts with parameters and slots)

When a "component" is more than a simple wrapper — when it takes parameters or has multiple content regions — declare it as a `template` instead. Templates are HTML strings with mustache placeholders.

#### Single-slot templates

The body content goes into the implicit `body` slot. Parameters become attributes on the directive.

```yaml
templates:
  row:
    params: [label, icon, speaker]
    template: |
      <div class="row">
        <div class="col-l">
          {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
          {{#if speaker}}<span class="speaker-name">{{speaker}}</span>{{/if}}
          {{#if icon}}<img src="assets/images/{{icon}}.png" alt="" class="margin-icon">{{/if}}
        </div>
        <div class="col-r">{{{body}}}</div>
      </div>
```

Use it:

```
:::row{label="45 min" icon=clock}

#### Welcome and introductions

The opening sets a friendly tone and connects participants to the day.

:::
```

Parameters can be omitted. When `label` isn't given, the `{{#if label}}` block disappears. The triple-mustache `{{{body}}}` inserts the parsed body HTML; the double-mustache `{{label}}` inserts attribute values with HTML escaping.

#### Multi-slot templates

When a template needs multiple content regions, declare named slots:

```yaml
templates:
  ad-lib:
    slots: [suggested]
    template: |
      <div class="ad-lib">
        <div class="ad-lib__suggested">{{{suggested}}}</div>
        <div class="ad-lib__box">
          <span class="ad-lib__label">your version</span>
        </div>
      </div>
```

In source, separate slots with `--- slotname ---`:

```
:::ad-lib

--- suggested ---

"Before we begin, I want to name a few things about where we are…"

:::
```

Each slot's content is parsed as Markdown.

### Inline HTML

Sometimes Markdown can't express what you need — a `<br>` inside a span, a CSS-grid layout for a cover page, etc. Just use raw HTML:

```
<div class="cover-tags">
  <div><span class="yellow-tag">A time-travel playbook for<br>inspiring coastal communities</span></div>
  <div><span class="yellow-tag">By Ruth Catlow and Ann Light</span></div>
</div>
```

Tender passes raw HTML through. The corresponding CSS lives in your `styles.css`. Reach for raw HTML sparingly — anything you find yourself reaching for repeatedly should become a component or template.

### Headings, lists, paragraphs, emphasis

These are vanilla CommonMark. Use whatever Markdown features you'd expect:

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

These render to standard HTML elements and you style them in `styles.css`.

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

components:
  callout:
    tag: aside
    class: callout
    attrs: [variant]
  stage-direction:
    tag: span
    class: stage-direction
    inline: true

templates:
  row:
    params: [label, icon, speaker]
    template: |
      <div class="row">…</div>
```

### `page-templates`

Every project must have a `default` page template. Declare any number of additional ones; reference them in source via `::::page{template=name}`.

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

The first page of any `chapter-opener` template gets no header; subsequent pages of the same template (if content overflows) get the `headers-rest` values.

### `typography`

| Field | Default | Notes |
|---|---|---|
| `lang` | `en` | Sets `<html lang>`; controls hyphenation dictionary in Chromium. |
| `hyphenation.enabled` | `true` | |
| `hyphenation.min-word-length` | `5` | Don't hyphenate words shorter than this. |
| `hyphenation.min-chars-before` | `2` | Min chars left on the previous line. |
| `hyphenation.min-chars-after` | `2` | Min chars on the next line. |
| `hyphenation.max-consecutive-hyphens` | (unlimited) | Max consecutive lines ending with a hyphen. |
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
:root {
  --font-display: 'Display', Georgia, serif;
}
h1 { font-family: var(--font-display); }
```

### `components`

| Field | Notes |
|---|---|
| `tag` | HTML element name (e.g. `aside`, `span`, `blockquote`). Required. |
| `class` | CSS class added to the element. |
| `attrs` | Whitelist of attribute names. Each becomes `data-name` on the element. |
| `inline` | If `true`, only valid as inline directive (`:name[…]`). |

**`palette` block (optional)** — overrides for the Palette tab in `tender preview`.

| Field | Notes |
|---|---|
| `attrs` / `params` | Object of attribute/param values for the default render. |
| `body` | Body content for the default render. |
| `slots` | Object of slot contents (for templates with named slots). |
| `variants` | List of variant objects (each can override any of the above), shown as additional renders in the tile. |

The `palette` block never affects PDF/HTML output — it's only used for the Palette tab's example tiles. Templates also support a `palette` block with the same shape.

### `templates`

| Field | Notes |
|---|---|
| `params` | Names of accepted attributes; available as `{{name}}` in the template. |
| `slots` | Names of named content slots; each available as `{{{slotname}}}`. Omit for single-slot templates that just use `{{{body}}}`. |
| `template` | Mustache (Handlebars) HTML string. Use `{{name}}` for attributes, `{{{slotname}}}` for raw HTML slots, `{{#if name}}…{{/if}}` for conditionals. |

Templates accept the same optional `palette` block described under [`components`](#components) above.

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

Use `pt`, `mm`, `cm`, `in` for type and spacing where the printed dimension matters; use `em` for proportional spacing relative to font size. Avoid `px` for anything print-critical.

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

A `::::page{template=cover}` becomes `<div class="page" data-page-template="cover">`, which you can target:

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

This pattern is how you implement bottom-anchored content, full-bleed covers, multi-column layouts on specific page templates, etc.

### Avoiding `!important`

Tender prepends a generated `_project.css` (your `@page` rules, hyphenation, etc.) before your `styles.css`. Your styles override automatically by source order. You should rarely need `!important`.

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

```yaml
templates:
  row:
    params: [icon]
    template: |
      <img src="assets/images/{{icon}}.png">
```

PNG, JPEG, GIF, SVG, WebP all work. In the standalone HTML output, images get base64-inlined; in the PDF, Chromium reads them off disk.

### Fonts

WOFF2, in `assets/fonts/`. Declare in `project.yaml`'s `fonts:` block — that emits the `@font-face` rules. You then use the font family in `styles.css` like any other.

---

## Authoring patterns

### A two-column layout (margin column + body)

The pattern from the worked example. Margin column carries labels, icons, speaker names; body column has the prose.

`project.yaml`:
```yaml
templates:
  row:
    params: [label, icon, speaker]
    template: |
      <div class="row">
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
:::row{label="45 min" icon=clock}

#### Stage 1. Welcome

The welcome sets a friendly tone…

:::
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
::::page{template=cover}

# This Coastal Planet

…cover content…

<div class="cover-spiral"><img src="assets/images/spiral.png" alt=""></div>

::::
```

### Keeping a block together across page breaks

```css
.callout      { break-inside: avoid; }
.row.no-break { break-inside: avoid; }
```

In source, a row template that takes a `no-break` flag:

```yaml
templates:
  row:
    params: [label, no-break]
    template: |
      <div class="row{{#if no-break}} no-break{{/if}}">…</div>
```

```
:::row{label="Note" no-break=true}

This whole block stays on one page.

:::
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
::::page{template=chapter-opener}

# Chapter 4

The chapter opens here. The running head is suppressed on this page,
and if the chapter overflows to subsequent pages those will get
"Chapter 4 / 17" style running heads automatically.

::::
```

---

## Validation

Run `tender lint my-doc` before building or committing. It catches:

- Malformed `project.yaml` (with the offending line).
- Unknown component or template names in `content.md` (with `content.md:LINE:COL`).
- Missing required slots in multi-slot templates.
- Missing `project.yaml` or `content.md`.

```
$ tender lint my-doc
error: content.md:42:1: Unknown component "callout-warning"
```

Exit code is non-zero on errors, suitable for CI.

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

Live-reloading HTML preview. Edits to `project.yaml`, `styles.css`, `content.md`, or any file in `assets/` trigger a rebuild and browser refresh.

```
tender preview my-doc
tender preview my-doc --port 3993
tender preview my-doc --host 0.0.0.0          # expose on LAN/Tailscale
tender preview my-doc --host 100.64.x.x       # bind only to a specific IP
```

The preview shows pages as printed sheets (white background, drop shadow, page numbers, margin guides) so you can see what the PDF will look like without re-exporting.

Build errors during preview surface in two places: in the terminal where `tender preview` is running, and as an error overlay in the browser. The server stays up and recovers when you fix the error.

Stop with Ctrl-C.

### `tender lint [dir]`

Validate without building. Exits non-zero on errors.

```
tender lint my-doc
```

---

## Security considerations

Tender renders via headless Chromium, launched with `--no-sandbox`. The flag is required on Linux hosts that disable unprivileged user namespaces (most CI environments fall into this category). The tradeoff: the rendering process runs without Chromium's normal sandbox isolation.

This is acceptable for the typical Tender use case — rendering local source files you author yourself. The risk surface only matters if you pipe **untrusted** content (Markdown, YAML, raw HTML, or images) into the build, in which case a malicious document could include script content that runs in the headless browser without sandboxing. Hosted-service deployments should consider running Tender in a separate container or VM and reviewing input sanitization.

## What's not in v1

Limitations to be aware of:

- **Single content file.** Multi-file content (chapters across files, with cross-references and continuous numbering) is a v2 item.
- **No in-source typographic markers.** Soft hyphens (`&shy;`), non-breaking spaces in source, and manual `<!-- pagebreak -->` comments are not honored. Hyphenation is governed by `project.yaml`'s `typography.hyphenation` block; page breaks are expressed as `::::page` boundaries.
- **No layout-warning system.** Bad column breaks, very-short last lines, orphans the engine couldn't fix — none flagged automatically. Your eye is the linter; the preview is the tool.
- **No mixed token + literal in headers/footers.** `"Page {page}"` will throw an error; use either a single token or a single literal per region.
- **RGB only.** No CMYK, PDF/X, or commercial prepress conformance.
- **No ePub or reflowable formats.** Tender is print-first; the standalone HTML output is just a portable mirror of the PDF, not a separate web target.

For the design rationale and roadmap, see [`docs/plans/2026-05-08-tender-design.md`](plans/2026-05-08-tender-design.md).
