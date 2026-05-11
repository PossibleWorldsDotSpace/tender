# Multi-document projects — design

**Date:** 2026-05-11
**Status:** approved
**Author:** brainstorming session with josh

## Problem

A Tender project today holds exactly one document: `content.md` at the project root. Authors who want several documents sharing the same components, styles, tokens, and assets (a CV + cover letter + portfolio, or a series of report variants) have no first-class way to do it. They have to either duplicate the whole project directory or swap `content.md` in and out.

We want a project to carry N documents that share one set of components/styles/tokens, with minimal new surface area.

## Solution overview

A document is any `.md` file at the project root other than reserved names. The project registry (components, `styles.css`, `project.yaml`, `assets/`) is loaded once and reused per document. CLI commands gain a `--doc <name>` flag to target one document; without it, `tender build` builds them all and `tender preview` exposes a switcher in the UI.

No new `project.yaml` keys. The document set is discovered from the filesystem.

## Project layout

```
my-project/
  project.yaml
  styles.css
  components/
  assets/
  cover-letter.md
  resume.md
  proposal.md
```

A single-document project keeps using `content.md` and looks unchanged from today, except the output file is named after the basename (`out/content.pdf`, not `out/document.pdf` — see Back-compat below).

### Reserved root `.md` names

These are skipped when enumerating documents:

- `README.md`
- Any file starting with `_` (e.g. `_draft.md`)

Everything else under the root that matches `*.md` is a document.

## CLI surface

```
tender build [dir]                # build every *.md → out/<basename>.{pdf,html}
tender build [dir] --doc resume   # build only resume.md
tender preview [dir]              # serve all docs; UI dropdown picks; default = content.md if present, else first alphabetically
tender preview [dir] --doc resume # serve with resume preselected (still switchable via UI)
tender lint [dir]                 # lint every *.md; findings carry the doc filename as today
tender clean <path>               # unchanged; explicit file path
```

`--doc` accepts the basename without extension. `--doc resume` and `--doc resume.md` both resolve to `resume.md`. If the name doesn't match a document at the root, the command fails with a list of available docs.

## Output naming

Output files use the markdown basename:

```
cover-letter.md   →  out/cover-letter.pdf, out/cover-letter.html
resume.md         →  out/resume.pdf, out/resume.html
content.md        →  out/content.pdf, out/content.html
```

This is a back-compat break for existing single-doc projects that script around `out/document.pdf`. Tender is pre-1.0 and the new behaviour is uniform; we're taking the break.

## Build pipeline

`buildProject(projectDir)` today returns one `BuildResult` for `content.md`. We refactor:

- `loadProjectRegistry(projectDir)` already returns components/CSS/config. Keep as is.
- Introduce `buildDocument(projectDir, docName, sharedRegistry)` that reads `<docName>.md`, parses, and produces a `BuildResult` with `docName` attached.
- `buildProject(projectDir, opts?)` becomes a thin wrapper that calls `listDocuments(projectDir)`, applies the optional `docName` filter, and returns `BuildResult[]`.

Calls that consume a single `BuildResult` (render, preview session) take one element from the array.

## Preview server

The server discovers docs at startup. The watcher's `classifyPath` widens: any root `*.md` is content (carrying its doc name).

WS messages gain a `doc` field on `content`-kind events, so the client can decide whether the currently visible doc needs a reload.

New endpoint:

- `GET /_tender/docs` → `{ docs: [{ name, basename, isContent }], default: <name> }`

Preview UI adds a doc dropdown in the existing header chrome. Switching docs fetches the rebuilt HTML for that doc; the server keeps a render session per doc (lazy-init on first request), so cold-start cost is paid once per doc per session.

## Lint

`lint(projectDir)` iterates `listDocuments(projectDir)` and runs the per-document checks (`deprecated-syntax`, `unknown-component`, `missing-asset`) once per doc. Each check takes a `contentPath` parameter instead of hard-coding `content.md`. Findings already carry `path`, so per-doc filenames appear in the report unchanged.

Cross-document checks (e.g. `unused-component` — a component used in any doc is considered used) operate on the union of references across all docs.

## Clean

`tender clean` is file-targeted today (`tender clean cover-letter.md`). That stays. With no positional arg in a multi-doc project, it errors with a list of available docs. In a single-doc project (only `content.md`), it keeps defaulting to `content.md`.

## Language server

No changes. The LSP operates on whichever `.md` URI VS Code has open.

## Out of scope (v1)

- **Per-doc token / component / page-template overrides.** If a doc needs different chrome, build a different component. We can add doc-level frontmatter later if real cases need it.
- **Per-doc `assets/` subfolders.** Shared `assets/` only.
- **A `documents:` key in `project.yaml`.** Filesystem is the source of truth; an explicit list would drift.
- **Combining docs into a single PDF.** Each doc renders independently.

## Documentation updates (CLAUDE.md parity)

Required in the same PR as the code change:

1. **`README.md`** — project layout example with multiple `*.md` files; document the `--doc` flag in the commands list; mention output naming change.
2. **`docs/user-guide.md`** — new "Multiple documents" section; update CLI reference for `--doc` on `build` and `preview`; note reserved root `.md` names; note output naming.
3. **`claude/skills/tender-author/SKILL.md`** — project-shape recap mentions root-level `*.md` as documents; reflect `--doc` flag where the skill references CLI commands.

## Testing

- Unit: `listDocuments` reserved-name filtering; `--doc` resolution (with and without `.md`); error message when name doesn't match.
- Integration (core): `buildProject` returns N results in a multi-doc fixture, one in a single-doc fixture; output filenames match basename.
- Integration (cli): `tender build` with no `--doc` in a multi-doc project writes one PDF per doc; `--doc resume` writes only `out/resume.pdf`.
- Preview: WS `content` events carry doc name; `GET /_tender/docs` returns the discovered set; switching docs in the UI doesn't break the watcher.
- Lint: per-doc findings include the right filename; `unused-component` considers references from every doc.
- Fixture: add a small multi-doc fixture under `packages/core/test/fixtures/` to anchor the behaviour.

## Migration

Single-doc projects keep working without changes, modulo the output filename. The skill and user-guide get a one-paragraph note about the `out/document.pdf` → `out/<basename>.pdf` change.
