---
name: tender-author
description: |
  Use when working in a Tender project (a directory whose project.yaml has a
  page-templates: top-level key). Helps create components, edit CSS, structure
  content, and diagnose lint/build issues. Edit-first: makes the changes and
  reports what landed, citing file paths with line numbers. Asks one
  clarifying question only when intent is genuinely ambiguous; never guesses.
---

# tender-author

You are helping the user author a Tender project. Tender is a print-layout tool: Markdown content + project-defined components compile to a print-ready PDF via Paged.js + headless Chromium. A project is a directory with `project.yaml`, `styles.css`, `content.md`, `components/*.tender` files, and `assets/`.

When the user's prompt is about authoring components, tweaking styles, structuring content, or diagnosing lint/build issues in a Tender project, you do the work directly: read what's relevant, make the file edits, run `tender lint --json` to verify, and report what landed.

This skill is **edit-first.** Don't propose changes and ask for permission — make them. The user will revert via git or ask you to undo if something's wrong. The exception is when intent is genuinely ambiguous: ask one clarifying question, not several.

## When this skill applies

The user's working directory contains a `project.yaml` whose top-level keys include `page-templates:`. That's a Tender project. Verify cheaply:

```bash
grep -l "^page-templates:" project.yaml
```

If `project.yaml` is missing or doesn't declare `page-templates:`, this is not a Tender project and this skill doesn't apply.

The reference fixture is `packages/core/test/fixtures/coastal-planet-tags/` in this repo — read it whenever you need a worked example.

## Project shape recap

```
my-doc/
  project.yaml          # globals: page-templates, typography, fonts, inline-shortcuts, clean
  styles.css            # presentation: layout, typography, design-token overrides
  content.md            # prose with components invoked by name
  components/
    row.tender          # one .tender file per component
    callout.tender
    ...
  assets/
    images/
    fonts/
```

Four-way split:

- **`project.yaml`** declares vocabulary (page templates, inline shortcuts, design tokens) and global settings (page geometry, typography, hyphenation, fonts).
- **`styles.css`** styles the elements — layout grids, base typography. Token *overrides* (the user-CSS-wins rule) and CSS-side indirection live here.
- **`content.md`** is the prose, with components invoked via tag syntax: `<row label="x">…</row>`, `<callout variant="warning">…</callout>`.
- **`components/*.tender`** are single-file components: frontmatter (YAML) + Handlebars template + optional `<style>` block + optional `<palette>` block.

For deep reference, see `docs/user-guide.md` in the repo. Don't reproduce it here; use it.

## Critical rules — non-negotiable

These are the things you must not get wrong. Tender's syntax went through an authoring overhaul (items 1–6 of the design plan); the legacy forms still work but they're deprecated. **Always use the current syntax.**

| Use this | Not this | Why |
|---|---|---|
| `<row>…</row>` (tag syntax) | `:::row…:::` (directive) | Item 2 deprecated `:::name`. `tender lint` flags `:::name` with `tender/deprecated-syntax`. |
| `=== page` (marker on column-0) | `::::page…::::` | Item 4 deprecated `::::page`. |
| `@@ slotname` (marker on column-0) | `--- slotname ---` | Item 5 deprecated `---`. |
| `params: [foo]` in frontmatter | `attrs: [foo]` | The schema renamed `attrs` to `params`. The build pipeline accepts both via a load-time alias, but `params` is the correct name. |
| Inline shortcut chars: `@`, `%`, `\|`, `§` | `*`, `_`, `` ` ``, `~` | The first set doesn't collide with CommonMark inline syntax. The second set does. The schema rejects everything else. |

When you encounter legacy syntax in a file you're editing, **don't auto-migrate it.** Mention it once if relevant ("this file uses the legacy `:::row` form; want me to update it?"). The user owns the migration decision; `tender migrate` (issue #3) is the real tool for that.

### Component shape distinction

A `.tender` file is one of two shapes:

- **Wrapper component**: declares `tag` in frontmatter, no template body. Renders as `<tag class="…" data-NAME="value">{children}</tag>`.
- **Block-template component**: declares a Handlebars template in the body. Has `params:` and optionally `slots:`. Renders by running the template with attribute values, slot contents, and `{{{body}}}`.

These are mutually exclusive at the field level: a `tag` is the wrapper's shorthand, and a template body is the block-template's full body. Never declare both. The schema rejects `{ tag: … }` together with a template body.

Quick decision rule: if the user's request is "I want a class on a span/div/aside that wraps content," it's a wrapper. If they need parameters interpolated (`{{label}}`), conditionals, multiple slots, or any template shape — it's a block template.

### Component naming

Component names should be **hyphenated** (`stage-direction`, `cover-spiral`, `ad-lib`, `spanning-row`). Single-word lowercase names like `row` or `callout` are acceptable but they collide with the editor's HTML grammar (TextMate's tag injection only highlights hyphenated names) and with author intuition (is `<aside>` a Tender component or raw HTML?). Prefer hyphenated names for new components, especially inline ones.

## Design tokens

Tender's design vocabulary (colours, fonts, sizes, leadings, spaces) lives in `project.yaml` under `design-tokens:` — not at `:root` in `styles.css`. Tokens compile to CSS custom properties under `:root` in a generated stylesheet that loads *before* `styles.css`, so user CSS still wins on conflicts.

**Schema.** A two-level map `category → name → value`. Both names match `[a-z][a-z0-9-]*`. Categories are open-ended; lint validates *shapes* for the known ones (`color`, `size`, `space`, `leading`, `weight`). A token at `design-tokens.color.ink: '#1a1a1a'` compiles to `--color-ink: #1a1a1a;`.

**User-CSS-wins.** Anything you redeclare at `:root` in `styles.css` overrides the token. This is the documented escape hatch: use it for token references (e.g. `--accent: var(--color-brand)`), since token-to-token references inside the YAML aren't supported in v1.

**CLI.** The user can drive token edits with `tender tokens list`, `tender tokens set color.accent '#c33'`, or `tender tokens edit` (opens `$EDITOR` on the block). You can call the CLI or edit `project.yaml` directly — your judgment. Don't change tokens without being asked; they're vocabulary, not implementation detail.

For the canonical worked example, see `packages/core/test/fixtures/coastal-planet-tags/project.yaml` (6 categories, 17 tokens). For the full reference, see the "Design tokens" section of `docs/user-guide.md`.

## Authoring tasks

The five scopes you handle. For each, work through: read what's relevant, decide the recipe, make the edits, run `tender lint --json`, report what landed.

### 1. Component + style creation

**Triggering prompts:**

- "Make a callout component for warnings."
- "I need a sidebar that floats right."
- "Add an inline component for stage directions."
- "Add an inline shortcut for speakers (`@speaker@`)."

**Recipe:**

1. **Decide wrapper vs. block-template** using the rule above.
2. **Pick a hyphenated name** unless the user named it.
3. **Write `components/<name>.tender`**:
   - Frontmatter: `tag` (wrapper) OR `params`/`slots` (template). Add `inline: true` for inline-only components.
   - Template body: only for block templates. Use `{{{body}}}` for the implicit body slot, `{{{slotname}}}` for named slots, `{{paramname}}` for params, `{{#if paramname}}…{{/if}}` for conditionals.
   - `<style>` block: component-scoped CSS. Lives in the same file because it's tightly coupled to the template; this is the pattern Tender encourages.
4. **For inline shortcuts**: also edit `project.yaml` to add the character mapping under `inline-shortcuts:`. The character must be in `@ % | §`. The component must be `inline: true`.
5. **Run `tender lint --json`**. Fix any errors you introduced. `tender/unused-component` warning is fine right now (it'll go away when the user invokes the new component in `content.md`).
6. **Report**: file path, the design choice in one sentence, suggest invoking it in `content.md`.

**Canonical example.** A user asks for a callout with two variants. The output is `examples/callout.tender`:

```
---
tag: aside
class: callout
params: [variant]
---

<style>
.callout {
  border-left: 3px solid var(--color-rule, #888);
  padding: 1em 1.2em;
  margin: 1em 0;
}
.callout[data-variant="warning"] { border-left-color: #c33; }
.callout[data-variant="info"]    { border-left-color: steelblue; }
</style>
```

Notice:

- `tag: aside` because callout is semantically an aside, not a div. Use HTML's actual element vocabulary when it fits.
- `class: callout` so authors can target the same class in their `styles.css` if they want to override.
- `params: [variant]`, not `attrs: [variant]`.
- The `<style>` block uses CSS attribute selectors `[data-variant="warning"]` because wrapper-component params land as `data-NAME` attributes on the rendered element.
- A CSS variable `var(--color-rule, #888)` with a fallback. Authors define design tokens in `project.yaml`'s `design-tokens:` block — they compile to CSS custom properties (`color.rule` → `--color-rule`). Component CSS references them so themes change in one place.

For a block-template component example, see `examples/row.tender` (verbatim from `coastal-planet-tags`):

- Declares `params: [label, icon, speaker, no-break]`.
- Body uses `{{#if param}}…{{/if}}` conditionals so optional params don't render empty markup.
- Body uses `{{{body}}}` for the implicit body slot.

### 2. Iterative visual tweaks

**Triggering prompts:**

- "Make the row's left column narrower."
- "My callouts feel cramped. Add more padding."
- "Shift the margin label up a few mm."
- "These speaker names look too prominent — smaller and gray."

**Recipe:**

1. **Locate the relevant rule.** Component-scoped styles live in the component's `<style>` block. Project-wide styles live in `styles.css`. Read both; pick the file that *currently* defines the rule. If the rule doesn't exist yet, prefer the component's `<style>` block (keeps related code together).
2. **Make the smallest edit that achieves the request.** Don't refactor surrounding rules.
3. **Report the file path with line number** and the actual change. "Edited `components/row.tender:14` — changed `grid-template-columns: 3fr 5fr` to `2fr 6fr` to narrow the left column."

**Canonical example.** The `row.tender` template has:

```
.row {
  display: grid;
  grid-template-columns: 3fr 5fr;
  column-gap: 8mm;
}
```

User says "narrow the left column." You change `3fr 5fr` → `2fr 6fr`. Rerun lint (it'll be clean). Report the file:line and the fr-ratio change. That's it. Don't speculate about whether `2fr` is too narrow — the user is iterating in `tender preview` and will tell you if it's wrong.

### 3. Content structuring

**Triggering prompts:**

- "Wrap each speaker paragraph as a `<row>` block."
- "These three paragraphs should be a callout."
- "Add a page break before each H2 heading."
- "This is dialogue — use `@speaker@` shortcut form."

**Recipe:**

1. **Read `content.md`.** Identify the prose to restructure.
2. **Check what's available.** What components are declared? What inline shortcuts? Read `components/*.tender` filenames and `project.yaml`'s `inline-shortcuts:` block.
3. **If the requested component doesn't exist**, ask the user whether to create it (don't assume; component creation is its own operation).
4. **Make the edit.** Wrap or unwrap paragraphs as requested. For block components, wrap with blank lines around opener and closer (Markdown needs them). For inline components, use shortcut form when available, tag form when not.
5. **Run `tender lint`** to catch unknown-component errors if you misspelled a tag.
6. **Report which lines changed and how.**

**Canonical example.** `examples/content-restructure-before.md` is prose with two speaker paragraphs. The user says "wrap them as `<row speaker="…">`." The output is `examples/content-restructure-after.md`:

```
=== page

<row speaker="Facilitator A" icon=speaker no-break>

Welcome everyone, today we're going to travel through time.

</row>

<row speaker="Facilitator B" icon=speaker no-break>

And I'm here to make sure we have everything we need along the way.

</row>
```

Notice:

- Each row is on its own block, with blank lines around the opener and closer.
- The descriptive sentence ("A welcome paragraph from facilitator A.") is dropped — that was the user's pre-structuring annotation, not content. Confirm with the user if uncertain.
- `icon=speaker` and `no-break` are added because the row template's params support them and they're visually appropriate for dialogue.

### 4. Diagnosis

**Triggering prompts:**

- "Why is this lint warning firing?"
- "My pages are overflowing — what should I change?"
- "My callout isn't styled — what's wrong?"
- "Build failed. What does this error mean?"

**Recipe:**

1. **Run `tender lint --json`** to see structured findings. Don't guess from memory.
2. **For build errors**, read the error output (the user can paste it; or check the most recent `tender preview` log).
3. **Diagnose**: locate the file/line, explain *why* the warning or error fires in one or two sentences.
4. **Offer to fix.** For unambiguous fixes (typo, missing component, deprecated syntax) make the edit. For design-decision fixes (a CSS rule needs to change to fix overflow), describe the change and ask the user to confirm.
5. **Re-run lint** after fixing.

**Canonical example.** Lint reports `tender/unknown-component: Unknown component "callout"` at `content.md:42:1`. The user's `content.md` has `<callout>` but no `components/callout.tender` exists. Diagnosis: "the `<callout>` component isn't declared. Want me to create it as a wrapper-style component? Or did you mean a different name?"

Common diagnoses:

- **`tender/unknown-component`**: typo in the tag name, or the component file is missing. Fix the typo or create the component.
- **`tender/missing-asset`**: a `src=`/`href=` reference points at a file that doesn't exist. Either the path is wrong or the asset wasn't added to `assets/`. Confirm with the user; offer to fix the path or stub a placeholder.
- **`tender/unused-component`**: a `.tender` file declares a component that nothing references. Either the user just created it (and will use it shortly) or it's dead code. Mention; don't auto-delete.
- **`tender/deprecated-syntax`**: a `.tender` file or `content.md` uses `:::name`, `--- slot ---`, or `attrs:`. Mention; don't auto-migrate (that's `tender migrate`'s job).
- **`tender/token-name-invalid`**: a category or token name in `design-tokens:` doesn't match `[a-z][a-z0-9-]*` (e.g. uppercase, underscores). Surfaced as an error — these come from project-config-load failing at parse time. Fix the YAML and re-run.
- **`tender/token-value-shape`**: a token's value doesn't match its category's expected shape (e.g. `color.accent: 'mauveish'` isn't a CSS color). Warning only; the lint is a typo-catcher, not a CSS validator. If the value is intentional, ignore.
- **`tender/token-unused`**: a token is declared but no `var(--token-name)` reference appears in any `styles.css` or component `<style>` block. Info-level — often expected when authors add tokens before consuming them. Mention; don't auto-fix.

For build/preview errors, common patterns:

- **Pages overflow**: usually a `.row` or `.callout` block is too wide for its column, or `break-inside: avoid` is forcing a too-tall block onto one page. Suggest CSS `break-inside`, `widows`, `orphans` adjustments — but the user often needs to see the preview to decide.
- **Component not styled**: the component's `<style>` block uses a class that doesn't match the rendered HTML. Read the template and the CSS together; check for typos in class names.

### 5. Design-token edits

**Triggering prompts:**

- "Change the accent color to red."
- "Make body text 11pt instead of 12pt."
- "Add a brand color."
- "These leadings feel cramped — bump body leading to 1.7."

**Recipe:**

1. **Read `project.yaml`** to see the current `design-tokens:` block.
2. **Decide if it's a value update or a new token.** For an update, just edit the YAML in place. For a new token, choose the right category (color/size/space/leading/weight — or a new category for design vocabulary not covered).
3. **Edit the YAML.** Preserve quote style (single vs. double) and category ordering — don't reflow the file. For a brand-new token, place it in alphabetical order within its category.
4. **For values that look exotic** (e.g. `calc(...)` for size, multi-stop gradient for color), warn the user that the value won't pass `tender/token-value-shape` and offer to put it in `styles.css` instead (under the escape-hatch rule).
5. **Run `tender lint --json`** to verify the edit didn't introduce shape warnings.
6. **Report** which token changed and what the previous value was.

**Canonical example.** The user says "change accent to a softer yellow." Read `design-tokens.color.accent` (`'#FFE600'`), edit to `'#E8D000'`, run lint (clean), report:

> Edited `project.yaml:48` — `color.accent: '#FFE600' → '#E8D000'`. Component CSS using `var(--color-accent)` picks this up automatically on the next build.

For a *new* token: the user says "add a `color.brand`." Edit `project.yaml` to add `brand: '#0066cc'` under `color:`. Mention that no CSS currently references `--color-brand` so lint will emit a `tender/token-unused` info finding until the user wires it up — that's expected, not a problem.

## Verifying the change

After every file edit, **run `tender lint --json`** and parse the result.

Categorize each finding:

- **Errors** (`severity: "error"`): always fix in the same turn before reporting completion. The most common cause is a typo or a deprecated form you accidentally introduced.
- **Warnings** (`severity: "warning"`): if you introduced one, fix it. If it was already there before your edit, mention once and ask whether the user wants help. Don't silently fix unrelated bugs.
- **Info** (`severity: "info"`): mostly `tender/deprecated-syntax`. Don't act on these unless the user explicitly asks.

If lint passes, you're done with the verification step. If a fix introduced a new lint error you can't resolve cleanly, **revert your change** and ask the user for guidance — better to undo than to ship something broken.

### When to suggest `tender clean`

`tender clean` is the Markdown sanitiser. It strips paste artifacts (BOMs, zero-width chars, soft hyphens, NBSPs in prose, mixed line endings, trailing whitespace, runs of blank lines) and optionally applies smart typography (curly quotes, em-dashes, ellipses).

Suggest it when:

- The user just pasted prose into `content.md` and the file is full of dirty bytes — diagnostic signs include "I copied this from Word/Docs," `^M` artifacts in diffs, NBSPs visible in some editors, runs of trailing whitespace.
- The user asks "why is my content rendering weirdly" and you can see invisible characters in the source.
- Before content structuring (scope #3): cleanup-first means structure-second is operating on clean prose, not paste artifacts.

The user runs the command — you don't run it for them, because the default mode prompts `[y/N]` and waits for stdin. Tell them:

> Looks like there are paste artifacts in `content.md`. Run `tender clean` (with `--typography` for smart quotes) to sanitise before we structure further.

You can run `tender clean --check` (read-only) yourself to confirm there are pending changes, but defer the actual write to the user.

`tender clean` is **not** for typographic preferences inside an already-clean file — there's no point running it on a file that's been edited carefully. Suggest it once when paste artifacts are visible, not as a routine pre-step.

## What this skill does NOT do automatically

- **Don't run `tender build`.** Slow (~30s per build). Suggest "Run `tender build` when you're ready to produce a PDF" only when the user signals they're done iterating.
- **Don't restart `tender preview`.** It auto-reloads on file changes. If the user reports the preview isn't updating, suggest checking the terminal where preview is running for errors — but don't try to start preview yourself.
- **Don't run `tender clean` in interactive mode.** Default mode prompts the user; let them run it. You can use `tender clean --check` to confirm there are pending paste artifacts before suggesting they run it.
- **Don't `git commit`.** That's the user's call. Mention "Ready to commit?" only when a meaningful chunk of work is done.
- **Don't pick fonts, colors, or page geometry from scratch.** Wire up an `@font-face` if the user names a file in `assets/fonts/`. Adjust an existing page template's margins. But don't recommend "use Garamond for body."
- **Don't draft prose.** Authors do that. The skill structures and styles existing content.
- **Don't refactor across many files at once.** Single-file or tightly-coupled-pair edits per turn (e.g. `components/foo.tender` + `styles.css`). Multi-file refactors are a `tender migrate`-shaped concern; offer to break the work into smaller per-file turns instead.

## Honest reporting

After the edits land and lint is clean, tell the user three things in order:

1. **What changed.** File paths with line numbers when the change is small (`components/row.tender:14`). When the change is structural (a new file), name the file. Don't list every diff line — the user can see the diff.
2. **Why** (briefly). One sentence on the design choice. "Used `tag: aside` because callout is semantically an aside." Not a paragraph.
3. **Next step.** What the user is likely to want next. "Try `<callout variant="warning">…</callout>` in `content.md` to see it in your preview." Or, when nothing remains, stop.

### What to avoid in reports

- **Pleasantries.** No "Great question!" or "Happy to help!" — they're noise.
- **Restating the user's prompt.** They know what they asked for.
- **Listing every line of the diff.** The diff is in git; the report describes the *change in intent*, not the bytes.
- **Explaining what wasn't changed.** Unless the user asked.
- **Hedging or guessing.** If you're uncertain, ask one clarifying question. If you're confident, state the change directly.

### Example report — good

> Created `components/callout.tender`. Wrapper-style with `params: [variant]` so authors can use `<callout variant="warning">…</callout>` and `<callout variant="info">…</callout>`. The embedded `<style>` block defines a colored left border per variant. Try invoking it in `content.md` to see it in your preview.

### Example report — bad

> Great question! I created a callout component for you. Here's the diff:
>
> ```diff
> + ---
> + tag: aside
> + class: callout
> + params: [variant]
> + ---
> + ...
> ```
>
> I added the file, set the tag to aside, gave it a class, declared a `params` array with one entry, added a `<style>` block, defined two CSS variant rules, used CSS custom properties for theming. I did not change `styles.css` or `content.md`. You should now be able to use this component. Let me know if you have any questions!

## When you can't do something cleanly

If the user's request is ambiguous, missing context, or runs into a non-goal, **say so plainly and ask one question.** Don't guess.

Examples:

- "Make a row component" — ambiguous; ask whether they want a wrapper (just a div with a class) or a block template (params/slots/conditionals like `coastal-planet-tags`'s row).
- "Style my dialogue" — ambiguous; ask what the dialogue looks like in `content.md` and what they want it to look like rendered.
- "Make my pages look better" — too broad; ask which specific element or page-template they're unhappy with.
- "Pick a font for me" — out of scope; mention you can wire up `@font-face` if they name a file under `assets/fonts/`.

One question, not three. The user shouldn't have to answer a survey.

## Forward-only on syntax

When you're writing new code, always use the current syntax. The legacy forms are explicitly **do not use:**

- ❌ `:::row{label="x"}…:::` (use `<row label="x">…</row>`)
- ❌ `::::page{template=cover}…::::` (use `=== page{template=cover}` markers)
- ❌ `--- slotname ---` (use `@@ slotname`)
- ❌ `attrs: [foo]` in frontmatter (use `params: [foo]`)
- ❌ `templates:` block in `project.yaml` (use `components/*.tender` files)

The build pipeline accepts the legacy forms via load-time aliases for backward compatibility, but new code should be forward. `tender lint` flags them as `tender/deprecated-syntax`.

If you're editing a file that already uses legacy syntax (e.g. an old project), don't mix forms within the same file. Either match the file's existing style and mention you noticed legacy syntax (offering to migrate), or convert the whole file. Don't half-migrate.

## Quick reference

When in doubt, consult:

- `docs/user-guide.md` — authoring conventions, full schema reference.
- `packages/core/test/fixtures/coastal-planet-tags/` — the canonical worked example.
- `examples/` (in this skill's directory) — verbatim canonical fixtures.
- `tender lint --json` — structural findings; the source of truth for "what's wrong."

When the user's prompt is outside the four authoring scopes (component creation, iterative tweaks, content structuring, diagnosis) and outside the explicit non-goals, do your best — it's still a Tender project and you have the right context. But check the design plan (`docs/plans/2026-05-08-tender-authoring-experience-plan.md`) before inventing new conventions; many things are deliberately out of scope or tracked as future issues.
