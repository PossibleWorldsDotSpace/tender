# `tender lint` v1 — Design

> Scope: design-level decisions for v1 of item 8 in `2026-05-08-tender-authoring-experience-plan.md`.
>
> v1 ships the four "cheap" structural checks. The remaining four CSS/HTML-aware checks (`orphan-css-class`, `raw-html-with-known-class`, `inconsistent-units`, `component-shadows-html`) plus the LSP integration are deferred and tracked as separate GitHub issues.

The current `tender lint` is a one-line wrapper around `buildProject` that surfaces structural errors only. Item 8 promotes it to a refinement assistant: warnings about drift between `.tender` files, content, and references. v1 lands the structural checks that don't need CSS/HTML analysis.

---

## Goal

Convert `tender lint` from "did the build break?" to "what's the next refinement?" without dragging in postcss or a full HTML parser. The four v1 checks all derive from data the build already produces.

---

## Architecture

New module group `packages/core/src/lint/`:

```
lint/
  index.ts        runLint(projectDir) → LintReport
  report.ts       LintReport + LintFinding types
  checks/
    unused-component.ts
    declared-slot-never-filled.ts
    missing-asset.ts
    deprecated-syntax.ts
```

The orchestrator `runLint`:

1. Calls `loadProjectRegistry(projectDir)` and reads `content.md`.
2. Runs `parseTags` on `content.md` to collect every tag invocation (the LSP recovery parser is the right tool — never throws).
3. Walks each component's template body and collects tag references inside templates too.
4. Dispatches each check function with the resulting state object.
5. Returns a `LintReport` of accumulated findings.

Each check is pure: takes the project state, returns `LintFinding[]`. No I/O inside checks except `missing-asset`'s file-stat.

`LintFinding`:

```ts
interface LintFinding {
  code: LintCode;
  severity: "error" | "warning" | "info";
  path: string;
  line?: number;
  column?: number;
  message: string;
  /** Free-form suggestion text for v1; LSP can render as a Code Action later. */
  suggestion?: string;
}

type LintCode =
  | "tender/unused-component"
  | "tender/declared-slot-never-filled"
  | "tender/missing-asset"
  | "tender/deprecated-syntax";
```

`LintReport`:

```ts
interface LintReport {
  findings: LintFinding[];
  /** True when severity:"error" appears, or any severity does in --strict mode. */
  hasFailures: boolean;
}
```

---

## Per-check detail

### `tender/unused-component` (warning)

For each registered component, check whether any tag invocation references it. References are collected from:
- `content.md` (via `parseTags`).
- Each component's template body (Handlebars-aware: a `<{{tag}}>` placeholder is *not* a reference because the tag name is dynamic; static `<row>` inside a template body is).

Components with zero references warn with the path of their `.tender` file (or `project.yaml` for legacy YAML entries).

Built-in components (`page`) are never flagged; they're always reachable.

A component referenced *only by another component that's itself unused* is also unused. The check uses transitive reachability: start from `content.md`'s tag references, walk closures through component bodies, mark visited; anything not visited is unused.

### `tender/declared-slot-never-filled` (warning)

For each registered component declaring `slots: [a, b]`, check every invocation of that component (in `content.md` or other component bodies). Each invocation either fills all slots correctly or fails the existing build-time check; for the lint warning, we want a softer signal: if a slot is *declared* but no invocation in the project's content fills it, flag the slot's declaration.

Implementation: collect `(componentName → Set<slotName>)` of slots actually filled. For each registered component, the difference between declared and filled is the warning set.

This catches slots authors added speculatively and never used. The warning points at the component file's frontmatter line.

### `tender/missing-asset` (error)

Walk:
- Every `.tender` template body for `src=` and `href=` attributes (HTML-shaped).
- Every Handlebars-rendered output that the build produces (the lint runs after a partial parse — we already have the HTML stream).
- Every `<img src="...">` style reference in `content.md`.

For each relative reference (excluding `http(s)://`, `data:`, `#anchor`), resolve relative to the source file's directory and check the file exists. Missing → error with the source line/column.

Error severity (not warning) because a missing asset breaks rendering. v1 catches static references; dynamic Handlebars-built paths (`assets/{{icon}}.png`) are out of scope — we'd need to enumerate possible param values.

### `tender/deprecated-syntax` (info)

Scan:
- `content.md` for `:::name` directive form (item 2 deprecation).
- `content.md` and component template bodies for `--- name ---` slot markers (item 5 deprecation).
- `project.yaml` for `templates:` block (item 1 deprecation, already migrated by the loader but worth flagging visibly).

Each occurrence emits an info-level finding with a one-line suggestion:

| Pattern | Suggestion |
|---------|------------|
| `:::name{...}` | `use <name ...>` |
| `--- name ---` | `use @@ name` |
| `templates:` in project.yaml | `move entries to components/*.tender` |

The check uses regex scanning rather than the AST because deprecated forms may not parse cleanly through the new pipeline.

---

## CLI surface

```
tender lint [dir] [--strict] [--json]
```

- Default: human-readable output. Each finding on its own line, grouped by severity, with file:line:column prefix and suggestion underneath when present. Mirrors the design plan's example.
- `--strict`: warnings promote to errors for CI gating. Exit code 1 if any warnings or errors.
- `--json`: emit `LintReport` as JSON. Useful for editor integrations and the future LSP adapter.
- Exit code: non-zero on errors (or `--strict` with warnings). Info findings never affect exit code.

Format:

```
warning: components/yellow-tag.tender:1: declared but never used [tender/unused-component]
warning: components/ad-lib.tender:3: slot "response" declared but never filled [tender/declared-slot-never-filled]
error:   components/cover-spiral.tender:5: asset "assets/images/spiral.png" not found [tender/missing-asset]
info:    content.md:24: deprecated syntax — use <row ...> [tender/deprecated-syntax]
         suggestion: replace `:::row{...}...:::` with `<row ...>...</row>`

3 warnings, 1 info, 1 error.
```

---

## LSP integration (deferred)

§8 of the design plan calls for the LSP to run cheap checks on every buffer change. v1 does *not* wire this up — the LSP keeps its current `provideDiagnostics`. A follow-up commit can adapt the four check functions into LSP diagnostics with minimal glue.

The check functions are designed pure precisely to make this adaptation easy: they return findings with file:line:column, which maps directly to LSP `Diagnostic` ranges.

---

## Tests

Each check has paired fixtures in `packages/core/test/fixtures/lint/`:

```
lint/
  unused-component-positive/   (a .tender exists; no usage)
  unused-component-negative/   (declared and used)
  unused-component-transitive/ (used only by another unused component)
  declared-slot-never-filled-positive/
  declared-slot-never-filled-negative/
  missing-asset-positive/
  missing-asset-negative/
  deprecated-syntax-positive/  (uses :::name and --- slot ---)
  deprecated-syntax-negative/  (uses <name> and @@ slot)
```

Each fixture is a minimal full project (project.yaml + content.md + components/). Unit tests load each fixture, run the relevant check, assert the finding count and codes.

Integration test: the migrated `coastal-planet-tags` fixture should produce *zero* findings after items 4–6 land. Today it would produce one `--- suggested ---` finding for `tender/deprecated-syntax`; once item 5's fixture migration runs (in the items-4-6 plan), it's clean.

---

## Out of scope for v1

Tracked as GitHub issues, not implemented here:

- **`tender/orphan-css-class`** — needs a CSS analyzer (postcss). A class declared in `<style>` or `styles.css` that no template emits and no inline HTML uses.
- **`tender/raw-html-with-known-class`** — needs an HTML parser (cheerio or htmlparser2). Inline `<div class="row">` in content.md when `row` is a registered component → suggest the tag form.
- **`tender/inconsistent-units`** — mixing `px` with `pt`/`mm` in print-critical CSS properties. Needs property-aware CSS parsing.
- **`tender/component-shadows-html`** — component name matches a built-in HTML tag (`a`, `em`, `strong`, etc.). Trivial to implement, but stylistically advisory; lower priority.
- **LSP integration** — adapt the four checks into the existing `provideDiagnostics` flow.

---

## Definition of done

v1 is "done" when:

1. `tender lint` returns the four v1 check findings on a fixture that exercises each.
2. `tender lint coastal-planet-tags` (post items 4–6) returns zero findings.
3. `--strict` and `--json` flags work as documented.
4. Build and goldens still pass; no regressions.
5. GH issues filed for the four deferred checks and the LSP integration.
