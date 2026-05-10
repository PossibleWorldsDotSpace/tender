# `tender-author` Claude Skill — Design

> The implementation plan that consumes this document is `2026-05-10-tender-author-skill-impl.md` (forthcoming).

A Claude skill that turns natural-language conversation about a Tender project into the right file edits. Lives in this repo at `claude/skills/tender-author/SKILL.md`, activates inside Claude Code when the working directory is a Tender project, and uses Claude Code's existing tools (Read, Edit, Write, Bash) plus the Tender CLI.

The skill is the second authoring surface for Tender. The first — the CLI — covers `init`, `clean`, `lint`, `preview`, `build`. The skill covers the *conversational* layer above that: "make a callout component," "tighten the row's left column," "wrap these paragraphs as dialogue," "explain this lint warning."

---

## Why a skill, not an MCP server or a `tender ask` agent

Three options were considered:

1. **Claude skill** (this design). Lives inside Claude Code; uses its existing tools; cheapest to build; only works for Claude Code users.
2. **MCP server.** Standalone process exposing Tender as tools any MCP-compatible client can call. Broader reach; more machinery; needs a long-running process and a tool surface design.
3. **`tender ask` CLI agent.** Tender ships its own AI agent with the Anthropic API or a local model. Heaviest dependency footprint; most ambitious.

**Picked 1.** Most Tender's target users are already in Claude Code or a similar IDE-AI surface; the skill leverages the editor + AI surface that's already on their machine. MCP is a good follow-up if usage grows beyond Claude Code; `tender ask` is overkill for the current scale.

---

## Scope

The skill handles four authoring surfaces:

1. **Component + style creation.** "Make a callout component for warnings" → writes `components/callout.tender` (frontmatter, template, embedded `<style>`); maybe edits `styles.css`.
2. **Iterative visual tweaks.** "Make the row's left column narrower" → finds the right CSS, edits it.
3. **Content structuring.** "Wrap these paragraphs as `<row speaker="…">`" → edits `content.md`.
4. **Diagnosis.** "Why is this lint warning firing?" / "My pages overflow" → reads `tender lint --json` or build output, explains, applies fix.

**Explicit non-goals:**

- **Doesn't run `tender preview` or `tender build`.** Both are user-controlled. Suggests them in passing.
- **Doesn't decide page geometry from scratch.** Page templates (size, margins, headers/footers) are design decisions. Skill helps tweak existing ones.
- **Doesn't choose fonts.** Wires up `@font-face` rules when a user names a file in `assets/fonts/`, but won't recommend "use Garamond."
- **Doesn't write content.** Authors do. The skill structures and styles existing content.
- **Doesn't refactor across many files at once.** Single-file or tightly-coupled-pair edits per turn. Multi-file refactors are a `tender migrate`-shaped concern (issue #3).

The principle: the skill helps with the **scaffolding and styling around the content**, not the content or the high-level design choices.

---

## Activation

Activates when the working directory contains a `project.yaml` whose top-level keys include `page-templates`. Tender's schema requires `page-templates` (specifically `page-templates.default`); no other tool we know of uses that combination, so the false-positive risk is negligible.

Claude verifies cheaply with a `grep -l '^page-templates:' project.yaml` or a quick first-line read. If `project.yaml` is missing or doesn't have the key, the skill is a no-op.

A future belt-and-suspenders signal — a `_format: tender` field in `project.yaml` — could land if false positives ever surface. Premature today.

---

## Handoff style

**Edit-first.** When the user describes intent, Claude:

1. Makes the file edits.
2. Runs `tender lint --json` to verify.
3. Reports what landed, citing file paths with line numbers.

The user reverts via git or asks Claude to undo. Matches how Claude Code is typically used; faster iteration than show-before-edit.

For ambiguous prompts, Claude asks one clarifying question instead of guessing. Don't ship a "smart dual-mode" — users never know whether they'll get a question or an edit, which erodes trust.

---

## Skill body — structure

The Markdown body is the model's reading material. Target ~500–800 lines. Sections:

1. **What this skill is for.** One paragraph.
2. **Project shape recap.** The four-file mental model (`project.yaml`, `styles.css`, `content.md`, `components/*.tender`) plus `assets/`. Not a re-documentation — link to `docs/user-guide.md` for the deep reference.
3. **Critical rules** — the things Claude *must not* get wrong:
   - `.tender` frontmatter uses `params`, not `attrs` (renamed in PR 1.x).
   - Slot markers are `@@ name`, not `--- name ---`.
   - Page boundaries are `=== page` markers, not `::::page`.
   - Inline-shortcut characters allowed: `@`, `%`, `|`, `§` only.
   - A wrapper component declares `tag`; a block-template component declares a body. Never both.
   - Component names should be hyphenated; single-word lowercase names collide with raw HTML.
4. **Authoring tasks** — one subsection per scope from above, each with:
   - Triggering prompts (examples).
   - The recipe (which files to touch, in what order).
   - One canonical example (verbatim diffs from `coastal-planet-tags` or hand-crafted).
5. **Verifying the change.** Run `tender lint --json`; fix introduced errors in the same turn; ignore unrelated pre-existing findings.
6. **Honest reporting.** What Claude tells the user at the end of each turn.
7. **Out-of-scope nudges.** When the user asks for something the skill doesn't do, say so plainly and redirect.

Tone: declarative, specific, "do this, don't do that." This is not a tutorial; the audience is a capable agent who already knows Markdown, CSS, and YAML.

### Critical-rules subsection — non-negotiable

The skill is forward-only on syntax. It uses the current syntax (`<row>`, `=== page`, `@@ slot`, `inline-shortcuts`, `params`) exclusively. The legacy forms (`:::row`, `::::page`, `--- slot ---`, `attrs`) get **explicit "do not use"** instructions in the skill body, with one sentence each on why (deprecated; will produce lint warnings; `tender migrate` is the path to upgrade existing projects). The skill never introduces deprecated syntax in new code, even when the surrounding file has it.

### Worked examples — canonical references

Four examples, drawn from `coastal-planet-tags`:

- **Component creation:** wrapper-style callout with two variants → `components/callout.tender` with embedded `<style>`.
- **Iterative tweak:** narrow `.row`'s left column → edit `components/row.tender:14` (`grid-template-columns: 3fr 5fr` → `2fr 6fr`).
- **Content structuring:** wrap dialogue paragraphs as `<row speaker="…" icon=speaker no-break>`.
- **Diagnosis:** explain `tender/unknown-component` lint warning, fix the typo or create the missing component.

Each example shows the user prompt, the skill's recipe (in skill-body voice), and the canonical output diff. Hand-crafted but real — files in `claude/skills/tender-author/examples/` that `tender lint`-pass.

---

## Verifying & honest reporting

### After each edit

1. Run `tender lint --json`.
2. Parse the findings:
   - `tender/unknown-component` / `tender/missing-asset` (errors) → fix in the same turn.
   - `tender/unused-component` (warning) → expected if a new component isn't yet invoked; ignore.
   - `tender/deprecated-syntax` (info) → don't auto-migrate; mention only if the user asked.
3. If the user introduced an error you didn't, mention once and ask whether they want help.

### What the skill does NOT do automatically

- **Doesn't run `tender build`.** Slow; not what the user asked for. Mention "Run `tender build` when you're ready" only when the user signals they're done.
- **Doesn't restart `tender preview`.** Live reload handles edits.
- **Doesn't `git commit`.** Mention "Ready to commit?" only when a change is large enough that a checkpoint makes sense.

### What Claude reports at end of turn

- **What changed.** File paths with line numbers. Name the rule or attribute that moved when the change is small.
- **Why** (briefly). One sentence on the design choice. "Used `tag: aside` because callout is semantically an aside."
- **Next step.** "Try `<callout variant="warning">…</callout>` in `content.md`." Stop when nothing remains.

Avoid: pleasantries ("Great question!"); restating the user's prompt; listing every diff line; explaining what wasn't changed unless asked.

When Claude can't do something cleanly — ambiguous request, missing context, design decision the skill explicitly punts on — say so and ask one clarifying question. Don't guess.

---

## File layout

```
claude/
  skills/
    tender-author/
      SKILL.md
      examples/
        callout.tender
        row-tweak-before.tender
        row-tweak-after.tender
        content-restructure-before.md
        content-restructure-after.md
```

The `claude/` top-level directory holds AI-integration assets (skills, future commands, future MCP server) distinct from the package source.

The `examples/` directory holds verbatim or near-verbatim fixtures so SKILL.md can reference them by relative path. They `tender lint`-pass under CI.

---

## Distribution

Two install paths for v1:

- **Symlink** (`ln -s "$(pwd)/claude/skills/tender-author" ~/.claude/skills/tender-author`) — for users who cloned the repo and want updates as they `git pull`.
- **Copy** the directory to `~/.claude/skills/tender-author/` — for users who want a static install.

Plugin-based distribution (one-command install via Claude Code's plugin system) is a follow-up — will be tracked in the slash-command issue's plugin-bundle work.

---

## Testing

Skills are prompts; no unit-test harness applies. The "tests" are:

1. **YAML frontmatter lint.** CI confirms `SKILL.md` parses, has `name` + `description`.
2. **Markdown lint.** Confirm well-formed, internal links resolve, code blocks balanced.
3. **Reference validity.** Every file path mentioned in `SKILL.md` exists in the repo (grep + stat).
4. **Worked-example freshness.** A synthetic project at `claude/skills/tender-author/examples/synthetic-project/` includes the example files and `tender lint`-passes under CI.
5. **Manual smoke prompts.** `claude/skills/tender-author/test-prompts.md` lists 8–10 prompts the skill should handle well. Periodically a human runs them in Claude Code and judges the output. Pins intent in writing so future contributors can tell whether a skill change improved or regressed.

(5) is the most honest test. Structural lints catch nothing about prompt quality; smoke prompts give us a benchmark.

### CI hookup

Structural checks (1–4) run as a new GitHub Actions step alongside typecheck. Fast (<5s).

---

## Definition of done

The skill is "done" when:

1. `claude/skills/tender-author/SKILL.md` exists with the structure described above.
2. `examples/` contains canonical examples that `tender lint`-pass.
3. CI runs structural checks on the skill file.
4. `test-prompts.md` lists the smoke-test corpus.
5. `docs/user-guide.md` and `README.md` mention the skill in a "Editor support" or similar section, with the symlink install instructions.
6. A manual smoke test against the smoke-prompt corpus produces output the design's principles describe.

## Out of scope (deferred to follow-up issues)

- **Slash command** (`/tender <prompt>` for project-context pre-loading) — issue #7.
- **Plugin distribution** — bundled with the slash command work.
- **MCP server** — separate concern, broader reach, not yet warranted.
- **`tender ask` CLI agent** — separate concern; only worth building if the skill proves useful enough that we want to extend reach.
