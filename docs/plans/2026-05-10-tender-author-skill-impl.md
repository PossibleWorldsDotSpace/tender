# `tender-author` Claude Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land a Claude skill at `claude/skills/tender-author/SKILL.md` that turns natural-language conversation about a Tender project into the right file edits, plus the supporting examples, CI checks, and install instructions.

**Architecture:** A single Markdown file with YAML frontmatter, distributed via symlink/copy in v1. Examples directory holds real Tender fixtures the skill body references by relative path. CI runs structural lints (frontmatter parse, internal-link validity, example freshness via `tender lint`). A separate smoke-prompt corpus pins our intent for manual regression testing.

**Tech Stack:** Markdown, YAML, Bash. No new runtime dependencies.

**Reference:** `docs/plans/2026-05-10-tender-author-skill-design.md`.

---

## Notes for the implementing engineer

- This plan looks unlike the others in this repo. Most tasks here are documentation drafting, not code. TDD-style "write the failing test, then implement" doesn't apply to most of it — there's nothing to fail.
- The skill body (Task 5) is the largest single chunk of work. Don't split it across many tasks; the prose needs internal coherence and that's lost in micro-commits.
- Use `coastal-planet-tags` as the source of truth for examples. Verbatim copies from that fixture are better than synthesized examples — they `tender lint`-pass and they're already battle-tested.
- Conventional commits per CLAUDE.md (`feat(claude-skill): …`, `docs: …`) with the `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer.
- The skill is meant for Claude Code users. Test it by manually running the smoke prompts in a Claude Code session against a Tender project — the structural lints in CI catch nothing about prompt quality.

---

## Task 1: Repo skeleton

**Files:**
- Create: `claude/skills/tender-author/` (directory)
- Create: `claude/skills/tender-author/examples/` (directory)
- Create: `claude/skills/tender-author/.gitkeep` (so git tracks the empty dir during early tasks)

**Step 1: Make the directories and a placeholder**

```
mkdir -p claude/skills/tender-author/examples
touch claude/skills/tender-author/.gitkeep
```

**Step 2: Commit**

```
git add claude/skills/tender-author/
git commit -m "$(cat <<'EOF'
chore(claude-skill): create claude/ tree for AI integration assets (tender-author step 1)

The top-level claude/ directory holds AI-integration assets (skills,
future commands, future MCP server) distinct from the package
source. Subsequent tasks fill in tender-author/SKILL.md and
examples/.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Frontmatter scaffold

**Files:**
- Create: `claude/skills/tender-author/SKILL.md` (frontmatter only; body comes in task 5)

**Step 1: Write the frontmatter**

```markdown
---
name: tender-author
description: |
  Use when working in a Tender project (a directory whose project.yaml has a
  page-templates: top-level key). Helps create components, edit CSS, structure
  content, and diagnose lint/build issues. Edit-first: makes the changes and
  reports what landed, citing file paths with line numbers. Asks one
  clarifying question only when intent is genuinely ambiguous; never guesses.
---

(SKILL.md body — to be written in task 5.)
```

**Step 2: Verify it parses**

A small Node one-liner confirms the YAML is well-formed:

```
node -e "
const fs = require('node:fs');
const src = fs.readFileSync('claude/skills/tender-author/SKILL.md', 'utf8');
const m = src.match(/^---\n([\s\S]*?)\n---/);
if (!m) { console.error('no frontmatter'); process.exit(1); }
const yaml = require('js-yaml');
const fm = yaml.load(m[1]);
if (!fm.name || !fm.description) {
  console.error('missing name or description'); process.exit(1);
}
console.log('OK; name =', fm.name);
"
```

Expected: `OK; name = tender-author`.

**Step 3: Commit**

```
git add claude/skills/tender-author/SKILL.md
git rm claude/skills/tender-author/.gitkeep
git commit -m "$(cat <<'EOF'
feat(claude-skill): SKILL.md frontmatter (tender-author step 2)

Bare frontmatter with name and description. The description tells
Claude when to invoke the skill (project.yaml with page-templates
key) and what its handoff style is (edit-first, file paths reported,
one clarifying question only when ambiguous).

Body is intentionally deferred to a focused commit in step 5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Examples — verbatim from coastal-planet-tags

**Files:**
- Copy from `packages/core/test/fixtures/coastal-planet-tags/components/row.tender` → `claude/skills/tender-author/examples/row.tender`
- Create: `claude/skills/tender-author/examples/callout.tender` (canonical wrapper component, hand-written)
- Create: `claude/skills/tender-author/examples/content-restructure-before.md`
- Create: `claude/skills/tender-author/examples/content-restructure-after.md`
- Create: `claude/skills/tender-author/examples/synthetic-project/` (a tiny full project that holds the example components and `tender lint`-passes)

**Step 1: Copy row.tender from the fixture**

```
cp packages/core/test/fixtures/coastal-planet-tags/components/row.tender \
   claude/skills/tender-author/examples/row.tender
```

**Step 2: Write the canonical callout.tender**

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

The frontmatter declares wrapper-style (`tag` present, no template body). The `<style>` block lives in the same file because it's component-scoped — that's the skill's pattern.

**Step 3: Write the content-restructure example pair**

`content-restructure-before.md`:

```
=== page

A welcome paragraph from facilitator A.

Welcome everyone, today we're going to travel through time.

A response from facilitator B.

And I'm here to make sure we have everything we need along the way.
```

`content-restructure-after.md`:

```
=== page

<row speaker="Facilitator A" icon=speaker no-break>

Welcome everyone, today we're going to travel through time.

</row>

<row speaker="Facilitator B" icon=speaker no-break>

And I'm here to make sure we have everything we need along the way.

</row>
```

**Step 4: Build the synthetic project**

A minimal Tender project that hosts these example components. CI runs `tender lint` against it as the freshness check.

```
claude/skills/tender-author/examples/synthetic-project/
  project.yaml            (page-templates: default; clean: typography: smart)
  styles.css              (tiny)
  content.md              (one <row>, one <callout>, smoke uses)
  components/
    row.tender            (verbatim from coastal-planet-tags)
    callout.tender        (verbatim from examples/callout.tender)
```

`project.yaml`:
```yaml
page-templates:
  default: { size: A5, margin: 0 }

clean:
  typography: smart
```

`content.md`:
```
=== page

# Smoke test

<callout variant="warning">

A warning callout for the synthetic example project.

</callout>

<row label="5 min" icon=clock>

A row with a margin label and an icon.

</row>
```

**Step 5: Verify the synthetic project lints clean**

```
pnpm -r build
node packages/cli/dist/cli.js lint claude/skills/tender-author/examples/synthetic-project
```

Expected: `ok` (no findings, exit 0). If lint surfaces warnings (e.g. unused-component for unused declared params), fix the synthetic project until it's clean.

**Step 6: Commit**

```
git add claude/skills/tender-author/examples/
git commit -m "$(cat <<'EOF'
feat(claude-skill): canonical examples for tender-author (tender-author step 3)

Six example files SKILL.md will reference by relative path:

- row.tender — verbatim from coastal-planet-tags; the canonical
  block-template component example.
- callout.tender — hand-written wrapper-style component with
  variants. Demonstrates the most common shape.
- content-restructure-before.md / after.md — paired before/after
  showing how prose with two speakers becomes <row> blocks.
- synthetic-project/ — a minimal Tender project that holds the
  examples and `tender lint`-passes under CI as the freshness check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Smoke prompt corpus

**Files:**
- Create: `claude/skills/tender-author/test-prompts.md`

**Step 1: Write the corpus**

8–12 prompts that the skill should handle well. These are the manual-regression spec.

```markdown
# tender-author smoke prompts

Run these in Claude Code with a Tender project open. The skill should
handle each according to the design's principles (edit-first, single
clarifying question only when ambiguous, file paths cited).

For each prompt, judge:
1. Did Claude make the right kind of change to the right file?
2. Did Claude run `tender lint` after the edit?
3. Was the report concise and honest (no pleasantries, no diff dump)?
4. Did Claude avoid out-of-scope work (running build, picking fonts, drafting prose)?

## Component creation

1. "Make a callout component for warnings, with a red left border and a quoted icon."
2. "I need an inline component for stage directions — italics, gray."
3. "Add a block component called 'aside' that floats right with a colored background."

## Iterative tweaks

4. "Make the row's left column narrower."
5. "My callouts feel cramped. More padding."
6. "The margin label is too far from the body text. Tighten it."

## Content structuring

7. (With a prose-only content.md open) "Wrap each speaker paragraph as a row block. The speakers are 'Facilitator A' and 'Facilitator B'."
8. "Add a page break before each H2 heading."

## Diagnosis

9. (After deliberately introducing `<callout-warning>` instead of `<callout>` in content.md) "Run lint and tell me what's wrong."
10. (After deliberately writing `attrs:` in a .tender file) "My component isn't working — why?"

## Out-of-scope

11. "Choose a serif font for me." (Expected: skill defers; mentions it doesn't pick fonts but will wire one up if the user names a file.)
12. "Write me an introduction paragraph." (Expected: skill defers; mentions it doesn't draft prose.)
```

**Step 2: Commit**

```
git add claude/skills/tender-author/test-prompts.md
git commit -m "$(cat <<'EOF'
feat(claude-skill): smoke-prompt corpus for tender-author (tender-author step 4)

12 prompts pinning the skill's intent in writing. Periodically a
human runs them in Claude Code and judges whether the skill's output
matches the design's principles. This is the most honest regression
test for prompt-driven behavior — structural lints catch nothing
about prompt quality.

Four prompts each across the four authoring surfaces (component
creation, iterative tweaks, content structuring, diagnosis), plus
two out-of-scope prompts that should produce a polite redirect.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Draft SKILL.md body

**Files:**
- Modify: `claude/skills/tender-author/SKILL.md` (replace the placeholder body with the full skill)

**This is the main task.** The body is one focused writing pass producing 500–800 lines of prose. Don't split into smaller tasks — internal coherence matters more than commit-size discipline here.

Structure (from the design doc §3):

1. **What this skill is for.** One paragraph.
2. **Project shape recap.** Brief; link to `docs/user-guide.md` for deep reference.
3. **Critical rules.** The non-negotiable rules: `params` not `attrs`, `@@ slot` not `--- slot ---`, `=== page` not `::::page`, allowed inline-shortcut chars, wrapper-vs-template distinction, hyphenated component names.
4. **Authoring tasks** — four subsections, one per scope:
   - **Component + style creation.** Triggers, recipe, canonical example referencing `examples/callout.tender`.
   - **Iterative visual tweaks.** Triggers, recipe, canonical example referencing `examples/row.tender` (narrowing the left column).
   - **Content structuring.** Triggers, recipe, canonical example referencing `examples/content-restructure-before.md` → `after.md`.
   - **Diagnosis.** Triggers, recipe, canonical example walking through a `tender/unknown-component` lint warning.
5. **Verifying the change.** Run `tender lint --json`; fix introduced errors; ignore unrelated pre-existing findings.
6. **Honest reporting.** What to include (file paths with line numbers, one-sentence why, next step). What to avoid (pleasantries, prompt restatement, diff dumps).
7. **Out-of-scope nudges.** When to politely redirect — running preview/build, deciding page geometry, choosing fonts, writing content, multi-file refactors.

### Style notes

- Tone: declarative, specific. "Do this. Don't do that." No tutorials.
- Audience: Claude (a capable agent who already knows Markdown, CSS, YAML).
- Voice consistency: every imperative is the skill talking to the model. Not "users should…", just "do…".
- Code blocks: every example is real and `tender lint`-passes (or is the *before* state of a fix-it example).
- Length: aim 500–800 lines.

### After writing

Verify the body's structural shape with a quick lint:

```
node -e "
const fs = require('node:fs');
const src = fs.readFileSync('claude/skills/tender-author/SKILL.md', 'utf8');
// Frontmatter + at least one heading per section.
const sections = ['What this skill', 'Project shape', 'Critical rules', 'Component', 'Iterative', 'Content structuring', 'Diagnosis', 'Verifying', 'Honest reporting', 'Out-of-scope'];
for (const s of sections) {
  if (!src.includes(s)) { console.error('missing section:', s); process.exit(1); }
}
console.log('all sections present');
"
```

Expected: `all sections present`.

**Commit**

```
git add claude/skills/tender-author/SKILL.md
git commit -m "$(cat <<'EOF'
feat(claude-skill): full SKILL.md body for tender-author (tender-author step 5)

500-800 lines of prose teaching Claude how to be a good Tender
authoring partner inside Claude Code. Structured per the design:

- Project shape recap.
- Critical rules (params not attrs, @@ not ---, === not ::::, etc.).
- Four authoring tasks, each with triggers, recipe, and canonical
  example referencing the verbatim files in examples/.
- Verifying via `tender lint --json`.
- Honest reporting: cite file paths with line numbers; one sentence
  on why; offer next step. Avoid pleasantries / prompt restatement /
  diff dumps.
- Out-of-scope redirects (no preview/build, no font choices, no
  prose drafting, no multi-file refactors).

Tone: declarative, specific, audience-is-Claude. Forward-only on
syntax — legacy :::name / ::::page / --- slot --- / attrs are
explicit "do not use" with reasoning.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Structural CI lints

**Files:**
- Create: `.github/workflows/skill-lint.yml`
- Create: `scripts/lint-skill.mjs`

**Step 1: Write the lint script**

```javascript
// scripts/lint-skill.mjs
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import yaml from "js-yaml";

const SKILL_PATH = "claude/skills/tender-author/SKILL.md";
const src = readFileSync(SKILL_PATH, "utf8");

// 1. Frontmatter must parse and have name + description.
const m = src.match(/^---\n([\s\S]*?)\n---/);
if (!m) {
  console.error(`${SKILL_PATH}: no frontmatter`);
  process.exit(1);
}
let fm;
try {
  fm = yaml.load(m[1]);
} catch (e) {
  console.error(`${SKILL_PATH}: frontmatter doesn't parse: ${e.message}`);
  process.exit(1);
}
if (!fm.name || !fm.description) {
  console.error(`${SKILL_PATH}: frontmatter missing name or description`);
  process.exit(1);
}

// 2. Internal links to examples/ must resolve.
const skillDir = dirname(SKILL_PATH);
const linkRegex = /examples\/[\w./-]+/g;
const referenced = new Set(src.match(linkRegex) ?? []);
for (const ref of referenced) {
  const path = resolve(skillDir, ref);
  try {
    statSync(path);
  } catch {
    console.error(`${SKILL_PATH}: referenced example does not exist: ${ref}`);
    process.exit(1);
  }
}

// 3. Synthetic project must lint clean.
import { execSync } from "node:child_process";
try {
  execSync(
    "node packages/cli/dist/cli.js lint " +
      "claude/skills/tender-author/examples/synthetic-project",
    { stdio: "pipe" }
  );
} catch (e) {
  console.error("synthetic-project does not lint clean:");
  console.error(e.stdout?.toString());
  console.error(e.stderr?.toString());
  process.exit(1);
}

console.log("skill lints OK");
```

**Step 2: Write the CI workflow**

```yaml
# .github/workflows/skill-lint.yml
name: skill-lint

on:
  push:
    branches: [trunk, main]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: node scripts/lint-skill.mjs
```

**Step 3: Run locally**

```
pnpm -r build
node scripts/lint-skill.mjs
```

Expected: `skill lints OK`.

**Step 4: Commit**

```
git add scripts/lint-skill.mjs .github/workflows/skill-lint.yml
git commit -m "$(cat <<'EOF'
ci(claude-skill): structural lints for tender-author (tender-author step 6)

Three checks run on every push and PR:

1. SKILL.md frontmatter parses; has `name` and `description`.
2. Every `examples/*` reference in SKILL.md resolves to a real file.
3. The synthetic-project under examples/ lints clean.

Catches structural rot only — never speaks to prompt quality. The
manual smoke-test corpus in test-prompts.md is the honest regression
test for that.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: README + user-guide mentions

**Files:**
- Modify: `README.md` (add "Editor support" or "AI authoring" section)
- Modify: `docs/user-guide.md` (mention near the Editor-support / VS-Code-extension section)

**Step 1: README mention**

After the existing "Editor support" section (which mentions the VS Code extension), add:

```markdown
### Authoring with Claude Code

A Claude skill at `claude/skills/tender-author/SKILL.md` lets you describe components, style tweaks, content structure, and diagnoses in natural language. Claude reads your project, makes the file edits, runs `tender lint`, and reports what landed.

To install:

```bash
ln -s "$(pwd)/claude/skills/tender-author" ~/.claude/skills/tender-author
```

(Symlink keeps you up-to-date as you `git pull`. Or copy the directory if you prefer a static install.)

Then, in Claude Code with a Tender project open:

```
> Make a callout component for warnings with a red left border.
> Wrap these dialogue paragraphs as <row> blocks with speaker attributes.
> Why is this lint warning firing?
```

The skill is scoped to authoring tasks: component creation, styling tweaks, content structuring, and lint/build diagnosis. It doesn't run preview/build, choose fonts, or draft prose — those stay with you.
```

**Step 2: User-guide mention**

Add a brief paragraph after the existing "VS Code extension" section, linking to the skill's design doc and the install instructions.

**Step 3: Commit**

```
git add README.md docs/user-guide.md
git commit -m "$(cat <<'EOF'
docs(claude-skill): README + user-guide mentions for tender-author (tender-author step 7)

Adds an "Authoring with Claude Code" subsection to both README.md
and the user guide. Covers symlink-based install and three example
prompts spanning the skill's four authoring surfaces.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Manual smoke test + report

**Files:**
- Create: `claude/skills/tender-author/test-results.md` (or keep the report ephemeral; choose at execution time)

**This task is genuinely manual.** No code change. The implementing engineer:

1. Symlinks the skill into their `~/.claude/skills/`.
2. Opens a Tender project in Claude Code (e.g. `coastal-planet-tags`).
3. Runs the 12 smoke prompts from `test-prompts.md` one at a time.
4. For each, judges:
   - Did Claude make the right kind of edit?
   - Did Claude run `tender lint`?
   - Was the report concise?
   - Did out-of-scope prompts get a polite redirect?
5. Writes a short report (free-form) describing what worked and what didn't.

If any prompt produces unwanted output, the skill body needs adjustment. Iterate on Task 5's commit before considering the skill done. **Don't ship a skill that fails its own smoke prompts.**

**Step 1: Run the smoke tests**

```
ln -s "$(pwd)/claude/skills/tender-author" ~/.claude/skills/tender-author
# Open Claude Code, point at a Tender project (e.g. examples/synthetic-project), run the prompts.
```

**Step 2: Decide whether the skill is ready**

If issues surface, amend SKILL.md and re-test. The acceptance bar:
- All four authoring scopes work cleanly on at least one prompt each.
- Out-of-scope prompts (#11, #12) produce polite redirects, not attempted edits.
- No silent failures (ambiguous prompts → clarifying questions, not guesses).

**Step 3: Commit**

If amendments to SKILL.md were needed, commit them with a clear message explaining what the smoke test surfaced. If no amendments, no commit needed.

---

## Done criteria

The `tender-author` skill is "done" when:

1. `claude/skills/tender-author/SKILL.md` exists with full body per the design.
2. `examples/` contains the canonical examples; the synthetic project `tender lint`-passes.
3. CI runs the structural lints (`scripts/lint-skill.mjs`) on every push.
4. `test-prompts.md` lists the smoke corpus.
5. README and user-guide mention the skill with install instructions.
6. A manual smoke test produces output matching the design's principles.

Total task count: 8. Estimated time: half a day to a day, depending on how long the SKILL.md body takes to draft cleanly.
