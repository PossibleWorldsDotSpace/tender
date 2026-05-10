# Claude Code project notes

Project-specific guidance for Claude Code sessions in the Tender repo. Read this before making changes; the rules below are load-bearing.

## Documentation parity is mandatory

When you change anything that affects user-facing behaviour, you must update the three places authors look. **Do this in the same PR / branch as the code change — not as a follow-up.**

The three places are:

1. **`README.md`** — the at-a-glance pitch and command list. Update if you:
   - Add/remove a CLI command or flag
   - Change a top-level `project.yaml` key
   - Change install instructions, project structure, or quick-start commands
2. **`docs/user-guide.md`** — the canonical author reference. Update if you:
   - Change source-file conventions (markdown syntax, component shape, page markers, slot markers)
   - Change the `project.yaml` schema in any way
   - Change `styles.css` cascade order or token resolution
   - Add or alter a lint code (the validation table)
   - Change a CLI command's behaviour, flags, or output shape
3. **`claude/skills/tender-author/SKILL.md`** — the in-session author behaviour for Claude. Update if you:
   - Add, rename, or remove an authoring scope (currently 5: components, styling, content, tokens, diagnosis)
   - Change the syntax authors should be using (the "Critical rules" table)
   - Change a lint code authors will see (the "Common diagnoses" list)
   - Change file-structure conventions (the project-shape recap, four-way split)
   - Change what the skill should NOT do automatically

The skill is symlinked from `~/.claude/skills/tender-author/` to `claude/skills/tender-author/` in this repo, so updates land alongside the code.

### Checklist before committing a user-facing change

Ask, in order:

- Did I add/remove/rename a CLI command or flag? → README.md commands list, user-guide.md CLI section, SKILL.md if the skill mentions it.
- Did I add/remove/rename a `project.yaml` key? → README.md project-structure comment, user-guide.md project.yaml reference, SKILL.md project-shape recap.
- Did I add/change a lint code? → user-guide.md validation table, SKILL.md common-diagnoses list.
- Did I change source-file conventions (page markers, slot markers, component frontmatter)? → user-guide.md source-conventions section, SKILL.md critical-rules table.
- Did I change the cascade order, token resolution, or any other build-pipeline behaviour authors observe? → user-guide.md "What you can do with CSS" / "Design tokens" / "styles.css conventions" sections, SKILL.md if relevant.

If a change is purely internal (refactors, test-only changes, dependency bumps that don't change behaviour, perf work), the docs stay as they are.

### Why this matters

Past changes have shipped where the code worked but `docs/user-guide.md` still described the old behaviour, or `SKILL.md` still taught the old syntax. Authors then write code that lints clean but doesn't match what the docs claim, or Claude sessions confidently produce stale patterns. The cost is silent drift — caught only when a new user hits the mismatch.

Treat docs as part of the change, not a follow-up.

## Repo layout

- `packages/core/` — schema, parsing, lint, palette, compile pipeline
- `packages/render/` — Paged.js + headless Chromium
- `packages/cli/` — `tender` command and subcommands
- `packages/preview-ui/` — SolidJS preview app served by `tender preview`
- `packages/language-server/` — LSP for `.tender` files (used by VS Code extension)
- `packages/vscode-extension/`
- `claude/skills/tender-author/` — the Claude skill (symlinked from `~/.claude/skills/`)
- `docs/user-guide.md` — author reference
- `docs/plans/` — design and implementation plans, dated
- `packages/core/test/fixtures/coastal-planet-tags/` — the canonical worked example

## Working defaults

- **Branch:** active work happens on `trunk`. `main` is the published branch.
- **Tests:** `pnpm test` runs the whole workspace; `pnpm --filter @tender/<pkg> test` for a single package.
- **Typecheck:** `pnpm typecheck` runs across all packages.
- **Build the CLI before manually smoke-testing:** `pnpm --filter @tender/cli build`. The shipped `node dist/cli.js` is what users get.
- **Don't run `tender build` repeatedly during dev** — Paged.js cold-starts at ~30s each. `tender preview` keeps Chromium hot.
- **Commit per task in plans;** small, reviewable commits beat one big one. Conventional commits (`feat(...)`, `fix(...)`, `docs(...)`, `chore(...)`).

## When in doubt

Read `docs/plans/2026-05-08-tender-authoring-experience-plan.md` for the design rationale of the current authoring surface, and the more recent dated plans for individual features (tokens, clean, lint, etc.).
