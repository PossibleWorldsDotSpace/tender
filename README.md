# Tender

A print-layout tool for text documents. Author in Markdown with project-defined components; build to print-ready PDF.

## Why

CSS Paged Media is the right layout engine for print: full typographic control, the same rules that power web layout, and a clear separation of content from presentation. Tender wraps Paged.js + headless Chromium in a small CLI so you can author documents in plain text and ship PDFs.

**What you can do with CSS:** anything Chromium renders, plus what Paged.js polyfills of the print spec — full Grid, Flexbox, modern selectors, container queries, custom properties, the lot. Tender takes a few opinions (a fixed cascade order, a `.page` wrapper around every page, project-local asset paths, no post-render JS) but doesn't restrict what CSS itself can do. See [`docs/user-guide.md`](docs/user-guide.md#what-you-can-do-with-css) for the detail.

## Install

Requires Node 20+ and pnpm.

```
git clone https://github.com/joshajh/tender.git
cd tender
pnpm install
pnpm -r build
```

For a global `tender` command:

```
pnpm --filter @tender/cli link --global
```

## Quick start

```
tender init my-doc
tender build my-doc
open my-doc/out/document.pdf
```

`tender preview my-doc` runs a live-reloading HTML preview at http://127.0.0.1:3993.

## Onboarding from existing prose

Pasting from Google Docs, Word, Pages, or another tool? After `tender init`, paste your prose into `content.md`, then sanitise:

```
tender clean my-doc/content.md          # strips BOMs, NBSPs, soft hyphens, mixed line endings, trailing whitespace
tender clean --typography my-doc/content.md   # also: curly quotes, em-dashes, ellipses
```

Then start authoring components in the live preview.

## Preview UI

`tender preview` opens a tabbed UI:

- **Preview** — the live-reloading rendered output.
- **Palette** — gallery of components and typography in this project, each rendered with project styles.
- **Help** — the user guide.

All three update automatically when you edit project files.

## Design tokens

Define your project's design vocabulary in `project.yaml` under `design-tokens:`:

```yaml
design-tokens:
  color:
    ink: '#1a1a1a'
    accent: '#FFE600'
  size:
    body: 12pt
```

These compile to CSS custom properties (`--color-ink`, `--size-body`, …) your components consume via `var()`. See the [design tokens guide](docs/user-guide.md#design-tokens) for the full schema and the `tender tokens` CLI.

## Project structure

```
my-doc/
  project.yaml      # page templates, typography, fonts, inline shortcuts, design tokens, clean, render
  styles.css        # presentation
  content.md        # prose + component invocations
  components/
    row.tender      # one .tender file per component
    callout.tender
  assets/
    images/
    fonts/
```

## Commands

- `tender init <dir>` — scaffold a new project from the default starter
- `tender build [dir]` — produce `out/document.pdf` and `out/document.html`
- `tender preview [dir]` — live-reloading HTML preview server (`--port`, `--host`)
- `tender lint [dir]` — validate project; surface unused/unknown components, missing assets, deprecated syntax (`--strict`, `--json`)
- `tender clean [path]` — sanitise content.md: strip paste artifacts; optionally apply smart typography (`--check`, `--yes`, `--typography`)
- `tender tokens list|set|edit` — inspect and edit design tokens (`--json` on `list`)

## Reference

- **User guide:** [`docs/user-guide.md`](docs/user-guide.md) — authoring conventions, `project.yaml` reference, `styles.css` patterns, CLI commands.
- **Design:** [`docs/plans/2026-05-08-tender-authoring-experience-plan.md`](docs/plans/2026-05-08-tender-authoring-experience-plan.md)
- **Worked example:** [`packages/core/test/fixtures/coastal-planet-tags/`](packages/core/test/fixtures/coastal-planet-tags/) — a workshop playbook reproducing the original `example.html`. Shows the full authoring stack: `=== page` markers, tag-syntax components, `@@` slots, and a multi-component layout.

## Editor support

A VS Code extension lives in [`packages/vscode-extension/`](packages/vscode-extension/). It spawns the language server, registers `.tender` as a custom language with TextMate grammars and snippets, and provides completion, hover, diagnostics, and definition jumps for both `.tender` files and tag-syntax in `content.md`.

### Authoring with Claude Code

A Claude skill at [`claude/skills/tender-author/`](claude/skills/tender-author/) lets you describe components, style tweaks, content structure, and diagnoses in natural language. Claude reads your project, makes the file edits, runs `tender lint`, and reports what landed.

To install:

```bash
ln -s "$(pwd)/claude/skills/tender-author" ~/.claude/skills/tender-author
```

(Symlink keeps you up-to-date as you `git pull`. Or copy the directory if you prefer a static install.)

Then, in Claude Code with a Tender project open:

```
> Make a callout component for warnings with a red left border.
> Wrap these dialogue paragraphs as <row> blocks with speaker attributes.
> Why is this lint warning firing?
```

The skill is scoped to authoring tasks: component creation, styling tweaks, content structuring, and lint/build diagnosis. It doesn't run preview/build, choose fonts, or draft prose — those stay with you.

## Security considerations

Tender renders documents in headless Chromium, launched with `--no-sandbox`. This is required on many Linux hosts (including most CI environments) where unprivileged user namespaces are disabled, but it means the rendering process runs without Chromium's normal sandbox isolation.

In practice the risk is low because Tender renders local fixtures you author yourself. If you ever pipe untrusted Markdown, YAML, or HTML into Tender (e.g. as part of a hosted service), this tradeoff deserves explicit review — a malicious document could include script content that the headless browser would execute without sandboxing.

## v1 limits

The following are intentionally out of scope for v1:
- Multi-file content (single `content.md` only)
- PDF/X / CMYK / commercial prepress (output is RGB)
- ePub or other reflowable formats
- Layout-warning system (orphan/widow/break linting)
- Full GUI editing surface (preview is read-only)
