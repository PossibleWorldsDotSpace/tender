# tender-author skill — status

## Implementation status

Tasks 1–7 of the implementation plan are complete:

- ✅ Repo skeleton (`claude/skills/tender-author/`)
- ✅ `SKILL.md` frontmatter
- ✅ Canonical examples + synthetic project (lints + builds clean)
- ✅ Smoke prompt corpus (`test-prompts.md`)
- ✅ Full `SKILL.md` body (356 lines)
- ✅ Structural CI lints (`scripts/lint-skill.mjs`, wired into `.github/workflows/ci.yml`)
- ✅ README + `docs/user-guide.md` mentions

## Manual smoke test — owed

Task 8 of the implementation plan is genuinely manual: an engineer needs to run the 12 smoke prompts in `test-prompts.md` against a real Tender project in Claude Code and judge whether the output matches the design's principles (edit-first, single clarifying question for ambiguity, file paths cited, no pleasantries, no out-of-scope work).

This wasn't completed during the initial implementation because the skill was being authored in the same Claude Code session where it would be tested — circular. The honest path is for a contributor to run the test in a fresh session against the synthetic project at `examples/synthetic-project/` (or a real Tender project of their own).

## How to run the smoke test

1. Install the skill (one-time):

   ```bash
   ln -sf "$(pwd)/claude/skills/tender-author" ~/.claude/skills/tender-author
   ```

2. Open a new Claude Code session in the synthetic project:

   ```bash
   cd claude/skills/tender-author/examples/synthetic-project
   claude
   ```

3. Run each prompt from `test-prompts.md` in turn. For each, judge:
   - Did Claude make the right kind of change to the right file?
   - Did Claude run `tender lint` after the edit?
   - Was the report concise (no pleasantries, no diff dump)?
   - Did out-of-scope prompts (#11, #12) produce a polite redirect, not an attempted edit?

4. If the skill misbehaves on any prompt, amend `SKILL.md` and re-test. Don't ship a skill that fails its own smoke prompts.

## Acceptance bar

The skill is "done" — and this STATUS.md can be deleted — when:

- All four authoring scopes work cleanly on at least one prompt each.
- Out-of-scope prompts produce polite redirects rather than attempted edits.
- No silent failures (ambiguous prompts produce clarifying questions, not guesses).
