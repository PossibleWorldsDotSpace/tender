# Design tokens — design

**Date:** 2026-05-10
**Status:** approved, ready to plan
**Phase:** authoring-experience expansion

## Why

Tender projects already use CSS custom properties for design vocabulary —
the `coastal-planet-tags` fixture defines `--color-ink`, `--font-display`,
`--size-h1`, `--col-gap`, etc. in `styles.css` under `:root`. Every Tender
project that does anything beyond "hello world" ends up with a similar
block. Lifting it into `project.yaml` gives the document a structured
surface for design vocabulary, mirrors how `page-templates` and
`typography` already live there, and unlocks tooling: a `tender tokens`
CLI that lists and edits the set; future `tender preview` UI can render a
swatch grid; the design plan stays grep-able and diffable across projects.

This doc is tokens-only. A separate "layout layer" was scoped during
brainstorming and dropped: the coastal pattern is solved by tokens alone
(reusable values like `3fr 5fr` and `8mm` are tokens, not containers),
and we don't yet have a document that fights the "hand-roll component
CSS" approach. Section 5 below summarises why.

## Schema

A new top-level `design-tokens:` key in `project.yaml`. Categorised: each
direct child is a category name (open-ended), each grandchild is a token
name → leaf value. Token references (one token referring to another) are
**not supported in v1.**

```yaml
design-tokens:
  color:
    ink: '#1a1a1a'
    page: '#ffffff'
    accent: '#FFE600'
  font:
    display: 'P22 Mackinac, Georgia, serif'
    body: 'Inter, system-ui, sans-serif'
  size:
    h1: 24pt
    body: 12pt
  leading:
    body: 1.6
  space:
    col-gap: 8mm
```

**Zod sketch:**

```ts
const TokenValue = z.union([z.string(), z.number()]);
const TokenGroup = z.record(z.string(), TokenValue);
const DesignTokens = z.record(z.string(), TokenGroup);
```

**Naming rules:**

- Category and token names match `/^[a-z][a-z0-9-]*$/` (lowercase,
  hyphenated). Anything else is a schema error.
- The CSS custom-property name is `--{category}-{name}`, e.g.
  `color.accent` → `--color-accent`.
- Token names must be unique within their category. Cross-category
  collisions are allowed (`color.ink` and `font.ink` both fine — they
  compile to different CSS variables).

**Reserved categories:** none enforced. The user-guide will recommend
`color`, `font`, `size`, `leading`, `space`, `weight` because lint's
value-shape rules know those shapes — but unknown categories pass
through untouched.

**Why no token references in v1.** CSS already does this for free —
`--accent: var(--brand)` in `styles.css` works, and user CSS is the
documented escape hatch (see Section 3 for the conflict-resolution
rule). Adding a YAML resolver duplicates CSS for marginal benefit; the
implementation cost (cycle detection, missing-ref errors, two evaluation
modes in the CLI) is high; YAGNI. If real users ask, adding a sigil is
non-breaking — existing literal values still parse.

## Compile path

`design-tokens:` compiles to a single `:root { ... }` block emitted as
the **first** rule in the project CSS bundle (before `@font-face`,
`@page`, etc.). User-authored `:root` rules in `styles.css` override via
cascade order — `styles.css` is concatenated after the project bundle.

**Where:** `packages/core/src/compose/project-css.ts`. Add a single
helper `emitTokensRoot(config["design-tokens"])` returning a `:root`
rule (or empty string if no tokens). Call it as the first append in
`generateProjectCss()`.

**Generated output:**

```css
:root {
  --color-ink: #1a1a1a;
  --color-page: #ffffff;
  --color-accent: #FFE600;
  --font-display: P22 Mackinac, Georgia, serif;
  --font-body: Inter, system-ui, sans-serif;
  --size-h1: 24pt;
  --size-body: 12pt;
  --leading-body: 1.6;
  --space-col-gap: 8mm;
}
```

**Value emission:** strings emit as-is (no added quotes); numbers
stringify directly. CSS values like `'Inter', system-ui, sans-serif`
already carry their own quotes when needed — treating them as opaque
strings is the right model. We do not validate that the result is valid
CSS; that's lint's job.

**Conflict resolution.** When the user already has a `:root { --foo: ... }`
in `styles.css`, **the user's CSS wins.** Generated tokens load first,
user CSS loads after. This is the documented escape hatch:

- "I want one token to derive from another" — write `--accent: var(--color-brand);` in styles.css.
- "I want to override a token for a print run" — define it in styles.css.
- "I want to A/B test a value without touching project.yaml" — same.

The user-guide must call this out explicitly with a worked example.

**Compile order in the bundle (after this change):**

1. `:root { /* design tokens */ }` ← new
2. `@font-face` rules
3. `@page` rules + page templates
4. `body { hyphens: ... }` and other typography
5. `.page { page: ... }` mapping
6. (then `styles.css` and component CSS append after this bundle)

## Lint

Three new lint codes, registered in the existing lint pass over
`project.yaml`. New file `packages/core/src/lint/rules/tokens.ts`,
exported from the lint registry. Tests under
`packages/core/test/fixtures/lint/tokens-*`.

**`tender/token-name-invalid` (error)** — category or token name doesn't
match `/^[a-z][a-z0-9-]*$/`. Catches typos like `Color:` or
`font_display`. Suggestion includes the corrected form.

**`tender/token-value-shape` (warning)** — the category is one of the
recognised set and the value doesn't fit:

| Category | Expected shape |
|---|---|
| `color.*` | `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()/hsl()/hsla()`, or a CSS named color |
| `size.*`, `space.*` | CSS length: `/^-?\d+(\.\d+)?(mm\|cm\|in\|pt\|px\|em\|rem)$/`, or `0` |
| `leading.*` | number, or unitless string parsing as number |
| `weight.*` | 100–900 in steps of 100, or `normal`/`bold`/`lighter`/`bolder` |

Unknown categories pass through with no value validation. Light-touch by
design: catches typos in the common cases without locking down
extensibility.

**`tender/token-unused` (info)** — declared but no `var(--token-name)`
reference in any `styles.css` or `components/*.tender` `<style>` block.
Info-level (not warning): tokens are often added speculatively before
the CSS that consumes them, matching `tender/unused-component`'s "mention,
don't scold" stance.

**No lint for the user-CSS-overrides-token case.** That's the documented
escape hatch — warning on it would punish the intended workflow.

## CLI: `tender tokens`

Three subcommands. Lives in `packages/cli/src/commands/tokens.ts`,
registered in `cli.ts` next to `lint`/`build`/`preview`/`init`/`clean`.
Help text follows the Examples-section pattern set by issue #6.

### `tender tokens list [dir]`

Reads `project.yaml`, prints the resolved token set grouped by category.
Color tokens get a one-character swatch via OSC truecolor escape
(terminals without truecolor degrade to plain text — same defensive
posture as the wordmark).

```
$ tender tokens list

color
  ink     #1a1a1a  ■
  page    #ffffff  ■
  accent  #FFE600  ■

font
  display  P22 Mackinac, Georgia, serif
  body     Inter, system-ui, sans-serif

size
  h1    24pt
  body  12pt

5 categories, 9 tokens.
```

`--json` flag emits `{ "category": { "name": "value" } }` for scripting.
No color, no swatches.

### `tender tokens set <token> <value> [dir]`

Writes the change to `project.yaml`, preserving comments and formatting.
Implementation uses `yaml` (npm package) in document mode: parse → AST →
mutate node → stringify. This round-trips cleanly so we don't lose
comments or reorder keys.

```
$ tender tokens set color.accent '#c33'
  color.accent: #FFE600 → #c33
  Wrote project.yaml.
```

If the new value fails lint's value-shape check, the warning is printed
but the write still happens — lint is advisory and the user might be
doing something the lint doesn't recognise.

If the token is **new**, the command creates it. Setting `color.brand
'#abc'` when no `color.brand` exists adds the leaf to the existing
`color:` group, or creates the group if needed:

```
$ tender tokens set color.brand '#abc'
  color.brand: (new) → #abc
  Wrote project.yaml.
```

### `tender tokens edit [dir]`

Minimal interactive picker (v1 scope explicitly limited; full picker
ticketed separately):

- ↑/↓ arrow keys navigate the token list.
- `Enter` starts editing the highlighted token's value (text input; no
  swatch picker, no length stepper).
- `Enter` commits the edit; `Esc` cancels the edit.
- `s` saves all pending edits to `project.yaml`.
- `q` quits. If unsaved edits exist, prompt `save? [y/n]`.

Built on Node's `readline` in raw mode — no `inquirer`/`prompts`
dependency, consistent with the no-runtime-deps posture from issue #6.
~150 lines.

A separate GitHub issue tracks the **full picker** (24-bit color
swatches with HSL sliders, length steppers with unit cycling, font
preview). Filed after the design lands.

## Out of scope (and why)

### Layout layer

Brainstorming included a layout layer (`layouts:` block defining
column/grid configurations consumable by page templates or components).
We dropped it because:

1. **The coastal-planet-tags fixture already proves tokens-alone is
   sufficient.** Every reusable value in coastal's CSS — `3fr 5fr`,
   `8mm`, baseline offset — is a token, not a container. Components
   (`.row`, `.ad-lib`, `.cover-tags`) hand-roll their own
   `display: grid; grid-template-columns: var(--space-grid-cols);`
   declarations and that's exactly the right granularity for print.
2. **No real document fights this approach.** A layout layer would
   solve a problem that doesn't yet exist. We'd be designing for an
   imagined future user.
3. **Adding tokens unblocks the layout layer if we want it later.**
   A future `layouts:` block could reference token names
   (`gap: space.col-gap`); the resolver for that is a 5-line regex.
   Nothing about tokens-only commits us either way.

If a future document genuinely needs a page-level grid abstraction (CSS
`column-count` style flow) or a reusable named container, that's a fresh
design pass. The token system this doc describes is forward-compatible.

### Token references

Covered above under "Why no token references in v1." Forward-compatible:
add a sigil later without breaking literal values.

### Token preview UI

The existing `tender preview` palette page can grow a "tokens" tab that
renders the swatch grid in HTML — out of scope for this doc, follows
naturally from the JSON shape `tender tokens list --json` produces.

## Implementation order

Phased so each step is independently shippable:

1. **Schema + compile.** Add `design-tokens` to `ProjectConfig`,
   implement `emitTokensRoot()`, wire into `generateProjectCss()`. Tests
   on the fixture's expected CSS output.
2. **Lint rules.** `tender/token-name-invalid`, `tender/token-value-shape`,
   `tender/token-unused`. Fixtures + tests.
3. **`tender tokens list` and `--json`.** Read-only path; smallest CLI
   surface; can ship before `set`/`edit` for early dogfooding.
4. **`tender tokens set`.** YAML AST round-trip; tests on
   comment/formatting preservation.
5. **`tender tokens edit`.** Interactive picker; manual smoke tests
   (no automated TTY tests).
6. **Migrate the `coastal-planet-tags` fixture** to use `design-tokens:`
   instead of hand-rolled `:root` in `styles.css`. Proves the round-trip
   end-to-end on a real document. Update `tender-author` skill examples
   to reflect the new authoring surface.
7. **User-guide section** explaining `design-tokens:`, the
   user-CSS-wins rule, and the CSS-side workaround for indirection.
8. **Open the "full token picker" GH issue** (color picker, length
   stepper, font preview).

## Open questions

None outstanding from the brainstorming pass. All decisions are
recorded above; the writing-plans pass should produce a numbered
implementation plan from the eight phases.
