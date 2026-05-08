# Tender

A print-layout tool for text documents. Author in Markdown with project-defined components and templates; build to print-ready PDF.

## Why

CSS Paged Media is the right layout engine for print: full typographic control, the same rules that power web layout, and a clear separation of content from presentation. Tender wraps Paged.js + headless Chromium in a small CLI so you can author documents in plain text and ship PDFs.

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

## Preview UI

`tender preview` opens a tabbed UI:

- **Preview** — the live-reloading rendered output (same as before).
- **Palette** — gallery of components, templates, and typography in this project, each rendered with project styles.
- **Help** — the user guide.

All three update automatically when you edit project files.

## Project structure

```
my-doc/
  project.yaml      # page templates, components, typography
  styles.css        # presentation
  content.md        # prose + component invocations
  assets/
    images/
    fonts/
```

## Commands

- `tender init <dir>` — scaffold a new project from the default starter
- `tender build [dir]` — produce `out/document.pdf` and `out/document.html`
- `tender preview [dir]` — live-reloading HTML preview server (default `--port 3993 --host 127.0.0.1`; pass `--host 0.0.0.0` to expose on LAN/Tailscale)
- `tender lint [dir]` — validate config and content; exit non-zero on errors

## Reference

- **User guide:** [`docs/user-guide.md`](docs/user-guide.md) — authoring conventions, `project.yaml` reference, `styles.css` patterns, CLI commands.
- **Design:** [`docs/plans/2026-05-08-tender-design.md`](docs/plans/2026-05-08-tender-design.md)
- **Implementation plan:** [`docs/plans/2026-05-08-tender-implementation.md`](docs/plans/2026-05-08-tender-implementation.md)
- **Worked example:** [`packages/core/test/fixtures/coastal-planet/`](packages/core/test/fixtures/coastal-planet/) — a workshop playbook reproducing the original `example.html`.

## Security considerations

Tender renders documents in headless Chromium, launched with `--no-sandbox`. This is required on many Linux hosts (including most CI environments) where unprivileged user namespaces are disabled, but it means the rendering process runs without Chromium's normal sandbox isolation.

In practice the risk is low because Tender renders local fixtures you author yourself. If you ever pipe untrusted Markdown, YAML, or HTML into Tender (e.g. as part of a hosted service), this tradeoff deserves explicit review — a malicious document could include script content that the headless browser would execute without sandboxing.

## v1 limits

The following are intentionally out of scope for v1 and tracked as roadmap items in the design doc:
- Multi-file content (single `content.md` only)
- In-source typographic markers (no soft hyphens, NBSP, manual page-break markers in prose)
- PDF/X / CMYK / commercial prepress (output is RGB)
- ePub or other reflowable formats
- Layout-warning system (orphan/widow/break linting)
- Full GUI editing surface (preview is read-only)
