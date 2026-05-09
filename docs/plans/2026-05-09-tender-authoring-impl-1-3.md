# Tender Authoring — Implementation Plan for Items 1–3

> Scope: implementation-level plan for the three foundational items in `2026-05-08-tender-authoring-experience-plan.md`:
>
> 1. Single-file `.tender` components
> 2. Tag-syntax invocation (`<row>…</row>`)
> 3. LSP + VS Code extension
>
> The design plan answers *what* and *why*. This plan answers *how*: file layout, function signatures, parser strategy, edge-case coverage, ordering, and what-not-to-build-yet.

The three items are deliberately ordered. **Item 1 lands first** — it gives every other layer a registry to read from. **Item 2 lands second** — it consumes the registry and unblocks the day-to-day authoring win. **Item 3 lands alongside item 2 or shortly after** — it's the editor pane onto the new syntax.

We are **not** maintaining `:::name` syntax through this transition. The migration (`tender migrate`, item 7 of the design plan) is the bridge, and is a follow-up. Until migration ships, existing fixtures keep working *only if* the deprecated parser path stays intact in parallel during the transition (see §"Coexistence strategy" below).

Throughout: prefer small, mergeable PRs. Each numbered step below is a PR-sized unit unless noted.

---

## Coexistence strategy (applies to items 1–3)

We ship the new pipeline alongside the old one for one development iteration, controlled by a registry-resolution rule:

- A project that has a `components/` directory uses the new pipeline (`.tender` files + tag syntax + new LSP).
- A project without `components/` uses the legacy pipeline (`project.yaml` `components:` + `templates:` + `:::name`).
- Mixed projects (both `components/` and YAML-defined templates) are allowed during migration: `.tender` files take precedence on name collision; YAML entries log a deprecation warning.

This rule is internal to `loadProjectRegistry` (see §1.2). All higher layers — parser, builder, lint, LSP — see a unified registry and don't branch on which source provided each entry.

Fixtures: keep existing fixtures (`hello`, `components`, `coastal-planet`) on the legacy path until `tender migrate` lands and they're re-converted. Add **new** fixtures for the new pipeline so the test surface grows on top, not underneath.

---

# Item 1: Single-file `.tender` components

Goal: parse `.tender` files into the existing in-memory component/template shape, replace `project.yaml`-as-component-source with `components/*.tender`-as-component-source where applicable, and emit each component's `<style>` block as part of the generated CSS.

## 1.1 File format

A `.tender` file has four sections; only the template is required.

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

**Section detection rules (deliberately simple, recovery-oriented):**

1. If the file starts with a line `---`, the frontmatter runs from the next line until a closing `---` line. If no closing `---` is found, that's a hard error.
2. After frontmatter (or from the start if none), everything up to a `<style>` or `<palette>` opener at column 0 is the **template**.
3. `<style>…</style>` and `<palette>…</palette>` are recognized only when their opener tag is at column 0. Inner content may include any text including raw `</style>`-shaped strings inside CSS string values; the closer must be at column 0 to count.
4. Order between `<style>` and `<palette>` doesn't matter; either may be omitted.

This format is regex-tractable. We do **not** use an HTML parser for section split — we use a small line-scanner. This is intentional: an HTML parser would be confused by Handlebars syntax inside the template. A line-scanner with column-0 anchors handles this with no special cases.

## 1.2 Public API

New module: `packages/core/src/parse/tender-file.ts`.

```ts
export interface TenderFile {
  /** Component or template name, derived from the filename without extension. */
  name: string;
  /** Absolute path; carried through for error messages and LSP definition jumps. */
  path: string;
  /** Frontmatter, parsed and validated; never undefined (defaults to {}). */
  frontmatter: TenderFrontmatter;
  /** Raw template HTML with Handlebars syntax preserved. */
  template: string;
  /** Inner content of <style>…</style>, or undefined if no style block. */
  style?: string;
  /** Inner content of <palette>…</palette>, parsed as YAML, or undefined. */
  palette?: PaletteBlock;
  /** 1-indexed line offsets so the LSP can map errors back to source. */
  offsets: {
    frontmatter?: { start: number; end: number };
    template: { start: number; end: number };
    style?: { start: number; end: number };
    palette?: { start: number; end: number };
  };
}

export interface TenderFrontmatter {
  params?: string[];
  slots?: string[];
  inline?: boolean;
  extends?: string;          // reserved; resolved later (item 10b)
  tag?: string;              // for "simple component" mode (no template body)
  class?: string;            // ditto
  attrs?: string[];          // ditto
}

export function parseTenderFile(source: string, path: string): TenderFile;
```

A new module: `packages/core/src/parse/load-components-dir.ts`.

```ts
export interface ComponentRegistry {
  /** Map from component name → resolved entry (template or simple component). */
  byName: Map<string, RegistryEntry>;
  /** Concatenated CSS from every component's <style> block, in alphabetical order. */
  combinedCss: string;
  /** Diagnostics produced during loading (deprecation warnings, etc.). */
  diagnostics: Diagnostic[];
}

export type RegistryEntry =
  | { kind: "component"; def: Component; source: { path: string } }
  | { kind: "template"; def: Template; source: { path: string } };

export async function loadComponentsDir(projectDir: string): Promise<ComponentRegistry>;
```

The merge with legacy YAML lives in `loadProjectRegistry` (a thin wrapper):

```ts
export async function loadProjectRegistry(projectDir: string): Promise<ComponentRegistry>;
```

**Behavior:**
1. Glob `{projectDir}/components/**/*.tender`.
2. For each file: `parseTenderFile`, then validate frontmatter against the existing Zod `Component`/`Template` schemas (whichever applies — see §1.3 for which is which).
3. Build the registry. On name collision between two `.tender` files: hard error.
4. If `project.yaml` has `components:` or `templates:` blocks, fold them in *with lower priority* than `.tender` files — log a deprecation diagnostic per entry, but accept them.
5. Concatenate every component's `<style>` content in alphabetical-by-name order; expose as `combinedCss`.

## 1.3 Schema integration

Today the schema distinguishes `Component` (simple wrapper: tag/class/attrs/inline) from `Template` (Handlebars template with params/slots). The `.tender` file format collapses both: the **frontmatter** chooses which by what it declares.

Decision rule:
- If frontmatter declares `tag` (and no `params`/`slots`/template body that uses `{{{body}}}`), treat as a simple component.
- Otherwise, treat as a template.

In practice a `.tender` file is almost always a template, because the tag form makes simple components only marginally simpler than templates. We keep the distinction internally for backwards compatibility with the existing AST resolution (`resolveComponents` vs `resolveTemplates`), but the `.tender` user-facing surface is unified.

For now, simple-component shorthand inside `.tender` files (`tag: span`, `class: stage-direction`, `inline: true`, no template body) is supported as a special case: the loader synthesizes a one-line template (`<{{tag}} class="{{class}}">{{{body}}}</{{tag}}>`) and continues as a template.

## 1.4 CSS pipeline

Currently `generateProjectCss` (in `compose/project-css.ts`) emits `_project.css` from `project.yaml`. The render layer serves `_project.css` and `styles.css` via Puppeteer request interception (`render.ts:26-37`).

**Add a third in-memory stylesheet: `_components.css`.** Generated from `ComponentRegistry.combinedCss`. Loaded *after* `_project.css` and *before* `styles.css`, so user `styles.css` still has final say.

Changes:
- `BuildResult` gains a `componentsCss: string` field.
- The composed HTML adds `<link rel="stylesheet" href="_components.css">` between the existing two links.
- `render.ts` adds the corresponding interception case.
- `composeDocument` is updated to emit the third link.

**Ordering rationale:** `_project.css` carries `@page` rules and design-token-flavored base typography from `project.yaml`'s typography block. `_components.css` is per-component visual styling. `styles.css` is user overrides and design tokens. Cascade order matches author intent: globals → components → custom.

## 1.5 Discovery is filesystem-driven, period

Do not introduce a `components:` registry section in `project.yaml`. Components are discovered solely by filesystem presence in `components/`. This keeps the project layout simple to reason about and means a new component requires no edit outside its own file.

If a user ever needs to *suppress* a component (e.g. a layout pulled in via `tender add layout` they don't want), the answer is "delete the file." No registry-level disable mechanism in v1.

## 1.6 Hot-reloading

The preview server's chokidar watcher already reacts to filesystem changes. Two updates:

- Add `components/**/*.tender` and any `_components.css`-influencing source to the watcher.
- A change in `components/` triggers a registry rebuild + full preview reload (same code path as a `project.yaml` change). The combined CSS is regenerated from scratch on each rebuild — small enough that incremental reload isn't needed yet.

For renames: chokidar emits `unlink` then `add` events. The registry rebuilds from scratch on either, so renames Just Work.

For deletions: a deleted component that was referenced in `content.md` produces a build error on next rebuild. The preview surfaces this in the existing error overlay.

## 1.7 Tests

Each test in `packages/core/src/parse/tender-file.test.ts` and `packages/core/src/parse/load-components-dir.test.ts`:

**`parseTenderFile`:**
- Frontmatter only.
- Template only (no frontmatter).
- All four sections present.
- Frontmatter unclosed → hard error with line number.
- `<style>` opener but no closer → hard error.
- `<style>` content includes the literal text `</style>` inside a CSS string value → still parses correctly because closer must be at column 0.
- `<palette>` parses as YAML and validates against the existing Palette schema.
- Inline component shorthand: frontmatter has only `inline: true` and `tag: span` and `class: x`, template absent → loader synthesizes the wrapper template.

**`loadComponentsDir`:**
- A directory with three `.tender` files produces a registry of three entries with combined CSS in alphabetical order.
- Two `.tender` files with the same name → hard error (with both paths).
- Mixed: `components/` directory + `project.yaml` `templates:` block. `.tender` wins on name collision; YAML entries log deprecation diagnostic; both end up in the registry.
- Empty `components/` directory + `project.yaml` `templates:` block → registry from YAML alone, deprecation warnings present.
- No `components/` directory at all → falls through to legacy registry from YAML (or empty registry if no YAML either).

**Build integration:**
- A new fixture `coastal-planet-tender/` (mirroring `coastal-planet` but with `.tender` files) builds successfully and produces non-empty output.
- The PDF golden test infrastructure (already shipped) is extended to cover `coastal-planet-tender`. Initially generated with `TENDER_UPDATE_GOLDENS=1`; subsequent runs assert byte-stable.

## 1.8 PR breakdown for item 1

Aim for these as separable PRs:

- **PR 1.1**: `parseTenderFile` + tests. Pure function, no integration. Smallest first PR.
- **PR 1.2**: `loadComponentsDir` + tests. Integrates with existing schemas; reads filesystem.
- **PR 1.3**: `loadProjectRegistry` (legacy + new merger), update `buildProject` to consume it, add `componentsCss` to `BuildResult`, update `composeDocument` and `render.ts` for the new stylesheet.
- **PR 1.4**: New `coastal-planet-tender` fixture; PDF golden + build tests.
- **PR 1.5**: Preview-server hot-reload integration for `components/` directory.

Item 1 is "done" when an author can write `.tender` files in a `components/` directory and have them appear in the build, with the legacy YAML path still working for un-migrated projects.

---

# Item 2: Tag-syntax invocation

Goal: in `content.md`, replace `:::name{attrs}…:::` with `<name attrs>…</name>`. Self-naming closers, HTML-style attributes, registered-component disambiguation against raw HTML, recursive Markdown parsing inside component bodies.

## 2.1 The parser-design decision

The plan describes the strategy ("pre-scan for registered tags before remark runs"). Three concrete implementations were considered:

**Option A: Hand-rolled tokenizer.** A purpose-built scanner that walks the source string, finds tag boundaries, replaces tag regions with sentinel placeholders, runs remark on the result, then post-processes to substitute parsed bodies back. Maximum control. Highest implementation cost.

**Option B: Fork remark-directive's approach.** Write a remark plugin (a `Parser` extension) that hooks into micromark's tokenizer to recognize `<name>`-shaped tokens. Fits cleanly in the existing pipeline. Significant micromark-extension expertise required.

**Option C: Build on `htmlparser2`.** We already depend on `htmlparser2` (added during the code-quality plan for `inlineAssets`). It's tolerant, fast, and has a stream-parser interface. Use it to tokenize, but only treat as a Tender component the tags whose names match the registry; everything else is passed through as raw HTML (which CommonMark already handles via its HTML-block rule).

**We pick Option A** for the production parser path. Reasons:

- The behavior we want is specific: only registered tags become components; only certain failure modes are errors; recursive Markdown parsing inside bodies is non-negotiable.
- The interaction with CommonMark's HTML-block rule is the entire reason the existing approach uses `:::name`. We need to *bypass* that rule in a controlled way, which means owning the tokenization.
- A hand-rolled scanner over the source string gives us position information directly (line/col offsets). This simplifies error messages and LSP source-mapping.
- We can keep the scanner small (~200 lines) and focused, with its own thorough test suite. It does *not* try to be a general HTML parser.

For the LSP (item 3), we use a **separate** recovery-oriented parser (see §3.5). The two parsers must agree on what counts as a tag; tests in §2.6 enforce this.

## 2.2 Pipeline placement

Today's pipeline (`parse/project-parser.ts`):

```
remarkParse → remarkDirective → resolveTemplates → resolveComponents → remarkRehype → rehypeStringify
```

New pipeline:

```
preProcessTags (NEW)        ← detects <name> tags, replaces with sentinel directive nodes
  → remarkParse
  → remarkDirective         ← (still present for legacy ::: support during transition)
  → resolveTemplates        ← unchanged
  → resolveComponents       ← unchanged
  → remarkRehype
  → rehypeStringify
```

The preprocessor turns `<row label="45 min">body</row>` into the same shape `:::row{label="45 min"} body :::` would produce — a `containerDirective` AST node with `name: "row"`, attributes, and children that are the parsed Markdown of the body. From that point downstream, the existing template/component resolution logic handles everything.

This is the smallest possible integration: the new syntax becomes sugar for the existing AST shape. `resolveTemplates` and `resolveComponents` don't change at all.

## 2.3 The preprocessor

New module: `packages/core/src/parse/preprocess-tags.ts`.

```ts
export interface PreprocessOptions {
  /** Names of registered components/templates. Tags with names outside this set are left alone. */
  registry: ReadonlySet<string>;
  /** Inline-only components — these MAY appear inside paragraphs. */
  inlineNames: ReadonlySet<string>;
  /** Source filename for error messages. */
  filename?: string;
}

export interface PreprocessResult {
  /** Source with component tags replaced by directive-shaped sentinels. */
  source: string;
  /** Position-mapping table so downstream errors can be remapped to original offsets. */
  sourceMap: SourceMapEntry[];
}

export function preprocessTags(source: string, opts: PreprocessOptions): PreprocessResult;
```

**Algorithm:**

1. Scan the source character-by-character with an index `i`.
2. When we see `<` followed by a letter (or `</` followed by a letter):
   - Read the tag name. If not in `registry`, skip — leave the tag as-is.
   - If a closer `</name>`, but no matching open on the stack, error.
   - If an opener: parse attributes up to `>` or `/>`, push onto the stack.
   - If a closer: pop the stack; verify the popped name matches; convert `[opener…inner…closer]` to `:::name{attrs}\n\ninner\n\n:::`.
   - Self-closing (`<name />`): convert to `:::name{attrs}\n\n:::`.
3. Inline tags (those declared `inline: true` in the registry): treat *any* occurrence as inline. Convert to remark-directive's inline form: `:name[inner]{attrs}`.
4. Otherwise, the tag is a block tag — surround with blank lines (so remark's block detector sees it correctly).
5. Maintain a position-mapping table: each character in the rewritten source has a known origin in the original source. This is what the source map enables.

**Edge cases handled in this module:**

- `<row>x</row>` mid-paragraph (block-only tag) → forces paragraph split with blank lines.
- `<stage-direction>x</stage-direction>` mid-paragraph (inline tag) → converts to `:stage-direction[x]`, paragraph stays intact.
- Mixed nesting: `<row><callout>x</callout></row>` → recursively converts; outer first, then inner inside the body.
- Quoted brackets in attributes: `<row label="more > less">…</row>` → attribute parser respects `"..."` and `'...'` quoting.
- Self-closing variants: `<x/>`, `<x />`, `<x ></x >` all valid.
- A tag whose name matches a registered component but whose closer doesn't match → error with both positions.
- A tag with attrs but unclosed angle bracket (`<row label="x"\nNot a tag.`) → treated as raw HTML; do not convert. (Distinction: a real component tag with a malformed close is an error. A non-component tag with malformed-anything passes through as raw HTML and CommonMark deals with it.)
- Tags inside fenced code blocks (` ``` `) and inline code (`` ` ``) → never converted. The scanner skips the contents of code spans.
- Tags inside HTML comments (`<!-- … -->`) → never converted.

## 2.4 Attribute parsing

Permissive HTML-attribute syntax, as described in the design plan:

```
attrs := (WS attr)* WS? "/?"? ">"
attr  := name ("=" value)?
name  := [a-zA-Z][a-zA-Z0-9-]*
value := "\"" [^"]* "\"" | "'" [^']* "'" | [^\s>]+
```

Boolean attributes (no `=value`) become `name="true"` (matches today's directive parser, which accepts `no-break=true` and could now also accept `no-break`).

Attribute names are validated against the registered component's `params` list at the resolveTemplates layer (where validation already happens) — the preprocessor doesn't need to know about params. This keeps the preprocessor decoupled from the schema.

Attribute values are forwarded as strings. Type coercion (boolean, number) happens in CSS via `data-*` selectors. No schema-level typing in v1.

## 2.5 Recursion strategy

When the preprocessor encounters a registered tag, it does **not** parse the body recursively itself — it just substitutes the directive form. The body is parsed as Markdown by the downstream `remarkParse` pass, which sees `<row…>\n\nbody\n\n:::` and parses everything between as a normal Markdown block.

But there's a subtlety: nested component tags inside the body. `<row><callout>x</callout></row>` becomes (after one pass):

```
:::row

<callout>x</callout>

:::
```

The `<callout>x</callout>` text is now inside a directive body, *which has not been pre-processed for tags*. We have two options:

**Option A: Run the preprocessor recursively on the body before substitution.** Cleaner and obviously correct, but the position-mapping gets more complex (need to layer maps).

**Option B: Run the preprocessor in a single pass, repeated until convergence.** Process all top-level tags first; downstream parsing extracts directive bodies as `containerDirective.children`; then *during AST resolution*, before `resolveTemplates` runs, walk the tree, find any text-shaped children that look like tag content, and re-run the preprocessor on them.

**We pick Option A.** Doing the recursion in the preprocessor (string → string) keeps a single source-of-truth for tag syntax and makes the source map a single layer. Implementation: the preprocessor handles nesting by, when it pushes an opener onto the stack, *not* immediately writing output — it accumulates the body as a substring, recursively preprocesses that substring, and only writes when popping the matching closer. (See §2.7 for the algorithmic shape.)

This means the preprocessor walks the source once with explicit nesting, rather than running multiple top-level passes.

## 2.6 Tests

`packages/core/src/parse/preprocess-tags.test.ts`:

**Block tags:**
- `<row>body</row>` → `:::row\n\nbody\n\n:::`.
- `<row label="x" icon=clock>body</row>` → directive with both attrs.
- `<row label="x">body</row>\nMore text` → tag converted; "More text" is separate paragraph.
- `Para before.\n<row>x</row>\nPara after.` → blank lines inserted around.

**Inline tags:**
- `Welcome. <stage-direction>he pauses</stage-direction> Today…` → `Welcome. :stage-direction[he pauses] Today…` (paragraph kept intact).
- `<stage-direction>x</stage-direction>` at start of a paragraph → still inline form.

**Self-closing:**
- `<cover-spiral />` → `:::cover-spiral\n\n:::`.
- `<cover-spiral/>`, `<cover-spiral></cover-spiral>` produce identical output.

**Nesting:**
- `<row><callout>x</callout></row>` → outer directive contains the inner directive correctly.
- `<row>**bold** and <stage-direction>x</stage-direction></row>` → preserves Markdown emphasis and inline component.

**Markdown inside body:**
- `<row>\n## Heading\n\nList:\n- a\n- b\n</row>` → produces a directive containing a heading and a list.

**Negative cases (left alone):**
- `<a href="…">link</a>` (`a` not in registry) → unchanged.
- `<not-a-component>x</not-a-component>` (not in registry) → unchanged.

**Error cases:**
- `<row>x` (no closer) → error pointing at the opener.
- `<row>x</callout>` (mismatched) → error pointing at both.
- Tags inside fenced code: ` ```html\n<row>x</row>\n``` ` → unchanged.

**Attribute parsing:**
- `<row label="more > less">x</row>` → attr parsed correctly.
- `<row no-break>x</row>` (boolean) → `no-break=true`.
- `<row label='single quotes'>x</row>` → handled.

**Source mapping:**
- Given an input with known offsets, the source map round-trips: a position in the rewritten source maps back to the correct line/col in the original.
- An error thrown at a position in the rewritten source surfaces with the original line/col in the error message.

**Integration tests** in `packages/core/src/build.test.ts`:
- A small fixture using `<row>` and `<stage-direction>` produces the expected HTML.
- The same fixture written in `:::row` style produces byte-identical HTML (regression for the directive path during transition).

## 2.7 Implementation notes (algorithmic shape)

```ts
// Pseudocode for preprocessTags
function scan(source, registry, inlineNames):
  result = ""
  stack = []   // each entry: { name, attrs, bodyStart, openerStart, openerEnd }
  i = 0

  while i < source.length:
    if at-fenced-code-block(source, i):
      copy block to result; advance i past it
      continue
    if at-comment(source, i):
      copy to result; advance i
      continue
    if source[i] == '<':
      tag = tryParseTag(source, i)        // returns { kind: "open"|"close"|"selfclose", name, attrs, end }
      if tag is null or tag.name not in registry:
        result += source[i]; i += 1
        continue
      if tag.kind == "selfclose":
        result += renderDirective(tag, "")
        i = tag.end
        continue
      if tag.kind == "open":
        stack.push({ ...tag, bodyStart: tag.end })
        i = tag.end
        continue
      if tag.kind == "close":
        top = stack.pop()
        if top.name != tag.name:
          throw error
        body = source.slice(top.bodyStart, i)
        innerProcessed = scan(body, registry, inlineNames)   // recursion
        if top.inline or stack.has-inline-context-context:
          result += `:${top.name}[${innerProcessed}]{attrs}`
        else:
          result += `:::${top.name}{attrs}\n\n${innerProcessed}\n\n:::`
        i = tag.end
        continue
    result += source[i]; i += 1

  if stack.length > 0:
    throw error("unclosed tags: ...")

  return result
```

The implementation is straightforward; the test surface (§2.6) is the harder part to get right.

## 2.8 PR breakdown for item 2

- **PR 2.1**: `tryParseTag` (the tag tokenizer) + tests for attribute parsing edge cases.
- **PR 2.2**: `preprocessTags` outer scanner + recursion + source map. Integration with `parseProject` to wire it in *behind a feature flag* (e.g. `TENDER_TAG_SYNTAX=1`). The flag exists so we can land the parser without forcing migration.
- **PR 2.3**: New fixture `coastal-planet-tags/` (mirrors `coastal-planet-tender` from PR 1.4 but with tag-syntax `content.md`); golden test asserts byte-identical PDF output to the `:::row` version.
- **PR 2.4**: Promote tag syntax to default; the legacy `:::name` path keeps working for un-migrated projects and is gated by the same registry merge logic from §"Coexistence strategy".

Item 2 is "done" when the new fixture builds, the golden tests confirm equivalent output, and tag syntax is the default path for new projects.

---

# Item 3: LSP + VS Code extension

Goal: VS Code knows about Tender. Autocomplete, hover, diagnostics, and go-to-definition work against the project's component registry. The LSP is independent of the build pipeline (it doesn't shell out to `tender build`); it has its own light parser and reads the project state directly.

## 3.1 Package structure

Two new packages.

```
packages/
  language-server/
    package.json              (depends on vscode-languageserver, @tender/core for schemas)
    src/
      server.ts               (LSP entry; stdio transport)
      project-index.ts        (watches project state; emits change events)
      providers/
        completion.ts
        hover.ts
        diagnostics.ts
        definition.ts
        document-symbols.ts
      parsers/
        tag-parser.ts         (recovery-oriented, reused by completion/diagnostics)
        tender-file-parser.ts (recovery-oriented .tender file split)
      types.ts
      util.ts
    test/

  vscode-extension/
    package.json              (extension manifest)
    src/
      extension.ts            (activate; spawn LSP; register file associations)
    syntaxes/
      tender.tmGrammar.json   (TextMate grammar for .tender)
      tender-md.tmGrammar.json (injection grammar for tag highlighting in .md)
    snippets/
      tender.code-snippets
```

The LSP imports `@tender/core` to reuse the Zod schemas and the `parseTenderFile` function. It does *not* call `parseProject` or any build-pipeline function — those throw on first error and don't recover, which is the wrong behavior for editor feedback.

## 3.2 Project index

`project-index.ts` is the LSP's stateful core. On startup and on file-system change, it builds:

```ts
interface ProjectIndex {
  componentByName: Map<string, ComponentSymbol>;
  pageTemplateByName: Map<string, PageTemplateSymbol>;
  inlineShortcuts: Map<string, string>;   // char → component name
  /** Diagnostics about the project itself (malformed project.yaml, etc.). */
  projectDiagnostics: Diagnostic[];
}

interface ComponentSymbol {
  name: string;
  path: string;                    // for definition jumps
  inline: boolean;
  params: string[];
  slots: string[];
  templateBody?: string;            // for hover docs
  rawFrontmatterRange?: Range;      // for definition jumps
}
```

**Update strategy:**
- On `project.yaml` change: reparse, rebuild `pageTemplateByName` and `inlineShortcuts`. Emit `onIndexChanged`.
- On any `components/**/*.tender` change: rebuild `componentByName` from scratch (cheap — the directory is small).
- On change to an open buffer that hasn't been saved yet: parse the buffer text directly (don't read from disk), apply to the index for that file.

The index never throws on bad input. Parse errors become diagnostics on the file that produced them; the rest of the index keeps working.

## 3.3 Recovery-oriented parsers

The build-time parsers throw on first error. The LSP needs parsers that produce *partial* results and a list of diagnostics, so the editor stays useful while the user is mid-keystroke.

**`tag-parser.ts`** — for `content.md` files:

```ts
export interface TagParseResult {
  tags: TagNode[];
  diagnostics: Diagnostic[];
}

export interface TagNode {
  name: string;
  kind: "block" | "inline" | "self-closing";
  attrs: AttrNode[];
  range: Range;             // full opener-to-closer
  openerRange: Range;
  closerRange?: Range;       // undefined for self-closing
  bodyRange?: Range;
}
```

This parser walks the buffer text and produces a list of tag nodes with ranges. It tolerates:
- Unclosed tags (records as a diagnostic, doesn't abort).
- Mismatched closers (diagnostic, doesn't abort).
- Half-typed attributes.
- Half-typed tag names.

It uses the same tokenization rules as the production preprocessor (§2.3) so the two agree on what's a tag. A regression test asserts equivalence on a corpus of inputs.

**`tender-file-parser.ts`** — for `.tender` files: recovery-oriented version of `parseTenderFile` that returns partial results. If frontmatter is unclosed, the rest of the file is still tokenized for the editor.

## 3.4 Provider behavior

**Completion provider** (debounced trigger characters: `<`, ` `, `=`):
- After `<` in `.md`: list every component name from the index, with snippet that fills in required attrs.
- Inside a tag's attribute area: list `params` of that component; suggest `=""` snippet.
- After `:` in `.tender` frontmatter at column 0: suggest schema keys (`params`, `slots`, `inline`, `tag`, `class`, `extends`).
- Inside `.tender` template body: suggest `{{name}}` for declared params and `{{{slotname}}}` for declared slots.

**Hover provider:**
- Tag name → component file path, params, slots, truncated template body.
- Attribute name → that param's documentation comment from frontmatter (we can support a JSDoc-style comment line above each param in frontmatter; deferred but the slot is reserved).
- `=== page{template=cover}` → resolved geometry.

**Diagnostics provider** (debounced ~150ms after buffer change):
- Run `tag-parser` on the buffer.
- For each tag: validate name against `componentByName`; validate attrs against the component's `params`; validate slot usage against `slots`.
- Surface unmatched tags, mismatched closers, slot markers in components without slots, page markers inside components.
- Each diagnostic carries a code; relevant codes get Code Actions ("Did you mean `<row>`?", "Generate `components/foo.tender`").

**Definition provider:**
- On `<row>` → jump to `components/row.tender`.
- On `=== page{template=cover}` → jump to `project.yaml`'s `cover:` entry.
- On `{{label}}` inside a `.tender` template → jump to the param declaration in frontmatter.

**Document symbols** (for `.tender` files):
- Outline showing the four sections.

## 3.5 Tag-parser equivalence with production

Critical correctness property: **the LSP's recovery-oriented `tag-parser` and the production `preprocessTags` must agree on what counts as a tag.**

Mechanism: a shared corpus of inputs in `packages/core/test/fixtures/tag-corpus/`. Each entry is a small text file plus a `.expected.json` describing the expected tag list. Two test suites consume the corpus:

- The production preprocessor's test asserts that for every corpus entry, its output round-trips through the directive pipeline correctly.
- The LSP's `tag-parser` test asserts that its tag list matches `.expected.json`.

When we update either parser, both suites must keep passing on the corpus. Drift becomes obvious immediately.

## 3.6 VS Code extension

Minimal — most logic is in the LSP.

**Activation:**
- Workspace contains a `project.yaml` at any depth, OR
- Any open file is a `.tender` file.

**Registered languages:**
- `.tender` files: language ID `tender`, registered with the new TextMate grammar.
- `.md` files within a Tender project: register an *injection* grammar that adds component-tag highlighting on top of standard Markdown highlighting. This is a TextMate grammar trick — the injection adds patterns scoped under `text.html.markdown` so it composes with whatever the user's existing Markdown grammar provides.

**LSP transport:** stdio. Standard pattern from `vscode-languageclient`. No fancy customization.

**Snippets** (per design plan): page break, common component invocations, new `.tender` component scaffold.

**Configuration** exposed in VS Code settings (`tender.*`):
- `tender.lsp.trace`: off | messages | verbose. For debugging.
- `tender.preview.openOnActivate`: boolean. When true, prompt to launch `tender preview` on workspace open. (Not required v1; placeholder.)

## 3.7 Tests

**LSP unit tests** (in `packages/language-server/test/`):
- Project index: given a synthetic workspace, the index loads correctly; on-change events fire.
- Each provider: stub the project index, feed a position, assert the result.

**LSP integration tests** (using `@vscode/test-cli` or similar):
- Open a workspace, type partial input, assert completion list, assert diagnostics range/severity, assert hover content.
- A handful of golden interactions.

**Tag-parser corpus tests** (§3.5).

## 3.8 PR breakdown for item 3

- **PR 3.1**: `language-server` package skeleton — server.ts, project-index.ts, basic startup. No providers yet; just verifies the LSP launches and registers.
- **PR 3.2**: `tag-parser.ts` + `tender-file-parser.ts` (recovery-oriented). Plus the corpus and equivalence tests.
- **PR 3.3**: Completion + hover providers + tests.
- **PR 3.4**: Diagnostics provider + tests.
- **PR 3.5**: Definition + document-symbols providers + tests.
- **PR 3.6**: `vscode-extension` package — manifest, activation, snippets.
- **PR 3.7**: TextMate grammars for `.tender` files and tag-injection for `.md`.
- **PR 3.8**: Integration tests via `@vscode/test-cli` for representative interactions.
- **PR 3.9**: Marketplace publication (separate PR; needs publisher account and CI gating).

Item 3 is "done" when a developer in VS Code, with the extension installed, gets useful autocomplete, hover, and diagnostics in both `content.md` and `*.tender` files in any Tender workspace.

---

# Cross-cutting concerns

## Order in real time

The three items are not strictly sequential. PR-level pipeline:

1. PRs 1.1, 1.2, 1.3, 1.4, 1.5 (item 1 in full).
2. PRs 2.1, 2.2 (item 2 parser + flag).
3. PR 3.1 (LSP skeleton). Can begin once 1.3 lands; doesn't depend on 2.x.
4. PR 2.3 (item 2 fixture/goldens). Depends on 1.4.
5. PR 3.2 (parsers). Depends on 2.1.
6. PRs 3.3, 3.4, 3.5 (LSP providers). In parallel.
7. PR 2.4 (promote tags to default).
8. PRs 3.6, 3.7 (VS Code extension shell).
9. PR 3.8 (extension integration tests).
10. PR 3.9 (publication).

A single developer can take this end-to-end in roughly two beats: foundation (item 1 + parser-only of item 2) → editor experience (item 3 + finalizing item 2). Each beat is on the order of a week.

## Test data lives in core

The tag corpus fixtures (`packages/core/test/fixtures/tag-corpus/`) are consumed by both `@tender/core` (production preprocessor) and `@tender/language-server` (recovery parser). Putting them in `core` matches the existing convention for `packages/core/test/fixtures/`, and `language-server` already devDeps `@tender/core` for schemas.

## Backwards compatibility while transition is in flight

Until `tender migrate` (item 7) ships, two things must hold:

1. Existing legacy fixtures (`hello`, `components`, `coastal-planet`, etc.) keep building correctly via the legacy `:::name` + `project.yaml` path.
2. New fixtures (`coastal-planet-tender`, `coastal-planet-tags`) build via the new path.

This works because `loadProjectRegistry` (§1.2) chooses the path based on filesystem presence, and the directive parser already supports `:::name`. We don't remove the legacy resolver until item 7 lands and projects are migrated.

## Out of scope for items 1–3

Even though they are described in the design plan, **do not implement** as part of this work:

- `tender migrate`. Postpone until items 1–3 are stable.
- `tender new` scaffolding. Same.
- `tender clean`. Item 9, separate.
- `tender lint` real warnings. Item 8, builds on top of LSP infrastructure.
- Template composition (`extends`). Item 10b, polish.
- Inspector (item 10a).
- Format-on-save in the LSP.

Each of those gets its own implementation plan once we're ready to tackle it.

## Definition of done

The three items together are "done" when:

1. A new project authored entirely as `components/*.tender` + `<row>…</row>` syntax + `=== page` markers builds correctly via `tender build`.
2. The same project, viewed in VS Code with the extension installed, has working autocomplete, hover, diagnostics, and definition jumps.
3. The PDF golden tests pass for both legacy (`coastal-planet`) and new-pipeline (`coastal-planet-tags`) fixtures, with byte-identical output between the two when content is equivalent.
4. The `coastal-planet-tags` golden has been generated *against the new pipeline* and reviewed.

Items 4–9 of the design plan extend from this foundation.
