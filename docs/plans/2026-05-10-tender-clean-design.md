# `tender clean` — Design

> Item 9 of `2026-05-08-tender-authoring-experience-plan.md`.
>
> The implementation plan that consumes this document is `2026-05-10-tender-clean-impl.md` (forthcoming).

A Markdown sanitiser. The user pastes prose into `content.md` from Word, Google Docs, or somewhere else, then runs `tender clean` to fix the bytes that confuse downstream parsing. No component knowledge, no project state, no content-to-layout conversion. Character-level work only.

The design plan §9's broader vision (paragraph-split suggestions, fence-balance check, interactive walk-through) is descoped. Those concerns live elsewhere: paragraph splits and component conversion are an authoring-loop feature (the LSP and `tender preview` are the right surfaces); fence-balance lives in `tender lint`. `tender clean` does one focused thing.

---

## Onboarding context

Picture a print designer with a 60-page Google Docs manuscript. Their realistic first five minutes:

```
tender init my-doc
# open my-doc/content.md in editor; paste prose; save
tender clean
# review the change summary; press y; file is saved back
tender preview
# now author <row>, <callout>, etc. on top of clean prose
```

`tender clean` is the second-to-last step before authoring. It doesn't try to *infer* component structure from prose ("this paragraph looks like dialogue, want to wrap it as `<row>`?") — that's a separate concern, possibly a future `tender wizard`. Clean's job is narrower: make the file's bytes safe so the rest of the pipeline can run.

The cleaner is **source-agnostic**. Some users will paste plain text (their editor flattens the rich-text clipboard); some will paste Markdown that Google Docs' "Copy as Markdown" feature produced; some will paste from Markdown-native tools like Notion. Same operations apply to all three cases — character-level sanitisation doesn't care whether the file has heading marks or not.

---

## Architecture

`tender clean [path]` is a CLI command that wraps a pure core function.

```
packages/cli/src/commands/clean.ts          (CLI entry, prompt logic, file I/O)
packages/core/src/clean/
  index.ts                                  (cleanText(source, opts) → { output, changes })
  normalizers/
    bom.ts
    line-endings.ts
    zero-width.ts
    soft-hyphens.ts
    nbsp.ts
    trailing-whitespace.ts
    multiple-blank-lines.ts
    typography.ts
```

The core lives in `@tender/core/clean/` alongside `lint/`. Each normalizer is a small string→string function or a `unified` plugin (depending on whether AST awareness helps). The orchestrator runs them in fixed order, accumulates a per-rule change count, and returns `{ output, changes }`.

The CLI wraps the core with file I/O, an interactive `[y/N]` prompt, and a flag set (`--check`, `--yes`, `--typography`).

Library choices: `unified` + `remark-parse` + `remark-stringify` already ship with `@tender/core`. For typography we adopt `retext-smartypants` (small, mature, idempotent by spec). The character-strip operations (BOM, zero-width, soft hyphens) are one-line regex replacements; no library needed.

---

## Normalizer rule set

Eight rules, run in this order:

| # | Rule | What | Default |
|---|------|------|---------|
| 1 | BOM removal | Strip leading `﻿` from file | on |
| 2 | Line endings | `\r\n` and `\r` → `\n` | on |
| 3 | Zero-width chars | Strip `​`, `‌`, `‍`, `⁠` | on |
| 4 | Soft hyphens | Strip `­` | on |
| 5 | NBSP normalization | ` ` → space | on |
| 6 | Trailing whitespace | Trim trailing spaces/tabs (preserve trailing `  ` for hard breaks) | on |
| 7 | Multiple blank lines | Collapse 3+ blank lines to 2 | on |
| 8 | Typography | `--` → `—`, `...` → `…`, straight quotes → curly | **off** |

Rule 8 (typography) is opt-in. Print designers who care about smart typography enable it; minimalists ignore it. Default-off avoids the highest-risk class of "tender mangled my text" complaints.

### Skip regions

These regions are preserved verbatim across every rule:

- Inside fenced code blocks (` ``` ` or `~~~`) and inline code spans (`` `…` ``).
- Inside Tender component openers (`<row label="…">`, `<page template="…">`, etc.).
- Column-0 Tender markers (`=== page`, `@@ slot`, `:::name`).

The remark AST already labels code spans and code blocks distinctly; for component openers and markers we add a small skip-region pass before the per-rule normalizers run, similar to what `preprocessTags` does internally.

### Edge cases

**Trailing-double-space hard breaks.** Markdown uses two trailing spaces on a line to mean "hard line break." Rule 6 preserves a trailing `  ` (exactly two ASCII spaces) on a non-blank line. Anything else is trimmed.

**NBSP in attribute values.** A user might paste `<row label="45 minutes">` where the space inside the quotes is actually NBSP. Rule 5 leaves attribute values alone; downstream parsing sees `45 minutes` with NBSP and treats it as a single attribute value. Acceptable: the build still works, and we don't risk corrupting attribute semantics.

**Mixed line endings.** Word/Word-export sometimes interleaves `\r\n` and lone `\r` (legacy Mac line endings). Rule 2 normalizes both in one pass.

**NBSP and typography order.** If typography is enabled, rule 5 runs *before* rule 8. So `45[NBSP]minutes` becomes `45 minutes` first, then any quotes around it get smart-quoted in their now-correct positions.

---

## Operator model

```
$ tender clean
content.md:
  3 zero-width characters removed
  2 NBSPs normalized to spaces
  4 lines trimmed of trailing whitespace
  1 soft hyphen removed

10 changes. Apply? [y/N]
```

Three modes:

- **Default (interactive).** Print the change summary, prompt `[y/N]`. Write back on `y`. The user sees what changed before any disk modification.
- **`--check`.** Print the summary, exit `0` if no changes pending, exit `1` if changes pending. Don't write. For CI gating ("did the author run `tender clean` before committing?").
- **`--yes`.** Skip the prompt; write immediately. For scripting.

Plus one orthogonal flag:

- **`--typography`.** Enable rule 8 for this invocation. Project config (below) provides a persistent equivalent.

Path resolution: `tender clean` with no arg cleans `content.md` in the current directory. `tender clean some-doc/content.md` works against an explicit path. v1 cleans one file at a time. A future `--all` walking every .tender template body and content.md is left unimplemented; the CLI grammar accommodates it.

When the file has no changes pending, the default mode prints `content.md: no changes.` and exits `0`. No prompt.

---

## Idempotency

Every rule is a fixed point. Running `tender clean` twice on a file produces zero changes the second time:

- Stripping a character that's already absent is a no-op.
- `\n` → `\n` is identity.
- Spaces don't become spaces twice (we don't replace existing spaces with NBSPs).
- Stripped lines have nothing to strip.
- 2 blank lines stays 2.
- `—` doesn't become `———`. `…` doesn't re-process. (`retext-smartypants` is idempotent by spec.)

The unit tests assert this for every rule individually. The integration test pattern: load a fixture, run `cleanText`, run again on the output, assert byte-identical.

---

## Project config

```yaml
# project.yaml (excerpt)
clean:
  typography: smart      # off | smart  (default: off)
```

`clean` is a new optional top-level block. Only one field for v1: `typography`. Validated by Zod alongside the existing schema.

If absent, behavior matches `clean: { typography: off }`. If `typography: smart`, every `tender clean` invocation behaves as if `--typography` were passed. The CLI flag overrides config-to-on, never to-off — there's no `--no-typography`. If you don't want typography, don't set the config.

Future fields (deferred):

- `clean.preserve-trailing-double-space: true | false` — opt out of the hard-break carve-out.
- `clean.dash-style: em | en | minimal` — control which dashes get unified.
- `clean.quote-direction: smart | dumb` — re-dumb-ify already-smart quotes.

None ship in v1. Mentioned only so the schema's shape (object, not a boolean) is forward-compatible.

---

## Tests

Three layers, mirroring the lint module's structure.

**Unit tests per normalizer** (`packages/core/src/clean/normalizers/*.test.ts`):

- Each normalizer has positive (rule fires) and negative (rule does nothing) cases.
- Idempotency: every test runs the function twice, asserts the second run is byte-identical.
- Skip-region cases inline in each normalizer's tests: e.g. `nbsp.test.ts` asserts NBSP inside fenced code, inline code, and inside a `<row label="…">` opener is preserved.

**Orchestrator tests** (`packages/core/src/clean/index.test.ts`):

- Composes the pipeline; verifies rule order matters where it does (NBSP-then-typography case).
- Default-vs-typography toggle: same input, two outputs, asserts the expected diff.
- Empty file / whitespace-only file is a no-op.
- A "Word paste" fixture with the kitchen-sink: BOM + `\r\n` + zero-width + NBSP + soft hyphens + trailing whitespace + smart quotes + em-dashes — asserts it cleans to the expected byte sequence.

**CLI tests** (`packages/cli/src/commands/clean.test.ts`):

- `--check` exits `0` on a clean file, `1` on a dirty one, doesn't write.
- `--yes` writes without prompt; second invocation reports "no changes."
- Default mode without `--yes`: stub stdin to `y`, verify write happens. Stub to `n`, verify no write.
- `--typography` produces different output than no flag for a fixture with `--`.
- `project.yaml`'s `clean.typography: smart` is equivalent to `--typography`.

**Integration**: a `coastal-planet-paste-artifact` fixture mirroring `coastal-planet-tags`'s content but with deliberately introduced paste artifacts (NBSPs, soft hyphens, smart quotes). After `tender clean --typography --yes`, the file is byte-identical to a hand-written "expected" version. PDF golden of the cleaned version matches the original `coastal-planet-tags` golden. Cleaning preserves *meaning*, not just bytes.

---

## Definition of done

`tender clean` v1 is complete when:

1. The eight rules are implemented; each has unit tests with positive, negative, and idempotency cases.
2. `tender clean` works end-to-end against the kitchen-sink "Word paste" fixture.
3. `--check`, `--yes`, and `--typography` flags work as documented.
4. Project config `clean.typography: smart` works as documented.
5. The integration fixture `coastal-planet-paste-artifact` cleans to a byte-identical expected file and produces the same PDF golden as `coastal-planet-tags`.
6. All workspace tests + typecheck green.
7. `docs/user-guide.md` and `README.md` are refreshed: bring both up to date with everything that's currently shipped (items 1–6, lint v1) **plus** add the new `tender clean` documentation. Document only the current syntax — no legacy `:::name` / `--- slot ---` / `::::page` examples. The legacy escape hatch (`TENDER_TAG_SYNTAX=0`) gets a single mention near the bottom as an emergency-bisection tool.
8. GH issue #5 closed.
