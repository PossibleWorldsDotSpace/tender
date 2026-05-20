# Contributing to Tender

Thanks for the interest. This document covers the bits you need to get a working build, run the tests, and iterate on the CLI / preview / language-server.

For an overview of what Tender is and what it does, see [`README.md`](README.md). For the author-facing reference, see [`docs/user-guide.md`](docs/user-guide.md). For the design rationale behind the current authoring surface, see [`docs/plans/2026-05-08-tender-authoring-experience-plan.md`](docs/plans/2026-05-08-tender-authoring-experience-plan.md).

## Prerequisites

- **Node 20+** (`>=20.0.0`). The CLI is bundled at build time for Node 20; later versions also work.
- **pnpm 9** (declared as the package manager). `npm i -g pnpm@9` if you don't have it.
- A working **headless Chromium**. `pnpm install` downloads one via puppeteer; on Ubuntu 23.10+ / hardened CI hosts the renderer falls back to `--no-sandbox` automatically (see "Security considerations" in the user guide).

## First-time setup

```bash
git clone https://github.com/possibleworldsdotspace/tender.git
cd tender
pnpm install        # also downloads the puppeteer Chromium
pnpm -r build       # build every package once
pnpm -r test        # full workspace test run — ~1 minute
pnpm -r typecheck   # full workspace typecheck
```

If `pnpm install` is the slow step, that's the Chromium download. It only happens on the first install per machine.

## Repo layout

- `packages/core/` — schema, parsing, lint, palette, compile pipeline
- `packages/render/` — Paged.js + headless Chromium
- `packages/cli/` — the `tender` command and subcommands (published as `@possibleworlds/tender`)
- `packages/preview-ui/` — SolidJS preview app served by `tender preview`
- `packages/language-server/` — LSP for `.tender` files
- `packages/vscode-extension/` — VS Code extension
- `claude/skills/tender-author/` — canonical Claude skill source; bundled into the CLI by build
- `docs/user-guide.md` — author reference
- `docs/plans/` — design and implementation plans, dated

## Working defaults

- **Branch:** active work happens on `trunk`. `main` is the published branch.
- **Tests:** `pnpm test` runs the whole workspace; `pnpm --filter @tender/<pkg> test` for a single package.
- **Typecheck:** `pnpm typecheck` runs across all packages.
- **Building the CLI before manual smoke-tests:** `pnpm --filter @possibleworlds/tender build`. The shipped `node dist/cli.js` is a single bundled file (see `packages/cli/tsup.config.ts`); the script builds the siblings first.
- **Don't run `tender build` repeatedly during dev** — Paged.js cold-starts at ~30s each. `tender preview` keeps Chromium hot.
- **Commit per task in plans;** small, reviewable commits beat one big one. Conventional commits (`feat(...)`, `fix(...)`, `docs(...)`, `chore(...)`).

## Running the CLI from a clone

After `pnpm --filter @possibleworlds/tender build`:

```bash
node packages/cli/dist/cli.js init my-project
node packages/cli/dist/cli.js preview my-project
```

Or `pnpm --filter @possibleworlds/tender exec tender preview my-project` after `npm link`.

## Running the VS Code extension from a clone

The extension isn't on the marketplace yet ([#2](https://github.com/possibleworldsdotspace/tender/issues/2)). Open `packages/vscode-extension/` in VS Code and press F5 to launch a development host with the extension loaded.

## Docs-parity rule

When you change anything user-facing, three places must update **in the same PR / branch as the code change** — not a follow-up:

1. **`README.md`** — for CLI command/flag changes, top-level `project.yaml` keys, install/quick-start commands.
2. **`docs/user-guide.md`** — for source-file conventions, the `project.yaml` schema, the cascade order or token resolution, lint codes, CLI command behaviour.
3. **`claude/skills/tender-author/SKILL.md`** — for authoring scopes, syntax authors use, lint codes, file-structure conventions, what the skill should NOT do.

`CLAUDE.md` has the full checklist. Treat docs as part of the change, not a follow-up.

## Commit messages

Conventional commits:

```
feat(scope): one-line summary

Longer explanation if useful. Wrap at ~72.
```

Common scopes: `cli`, `core`, `render`, `preview`, `preview-ui`, `lsp`, `vscode`, `docs`, `chore`. The body is for the **why** — the diff already shows the what.

## Reporting issues

Use [GitHub Issues](https://github.com/possibleworldsdotspace/tender/issues). For a bug, include: Tender version (`tender --version`), Node version, OS, the smallest project layout that reproduces. For a feature request, describe the document you're trying to typeset and what's awkward today — that's usually more useful than the specific API you have in mind.

## Security

If you find a security-relevant issue, please **don't** file a public issue. Email josh@possibleworlds.space directly.
