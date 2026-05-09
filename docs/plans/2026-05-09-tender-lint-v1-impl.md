# `tender lint` v1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote `tender lint` from a one-line `buildProject` wrapper to a refinement assistant by adding four cheap structural checks: `unused-component`, `declared-slot-never-filled`, `missing-asset`, `deprecated-syntax`.

**Architecture:** New module group `packages/core/src/lint/` with an orchestrator and four pure check functions, plus per-check fixtures under `packages/core/test/fixtures/lint/`. The CLI command rewrites to consume the orchestrator. LSP integration is deferred.

**Tech Stack:** TypeScript, vitest, the existing `@tender/core` and `@tender/cli` packages.

**Reference:** `docs/plans/2026-05-09-tender-lint-v1-design.md`.

**Prerequisite:** Items 4–6 are merged (the deprecated-syntax check needs to know `@@` is the new slot form and `<name>` is the new component form).

---

## Notes for the implementing engineer

- This plan ships v1 only. Four other lint checks plus LSP integration are tracked as separate GitHub issues.
- `LintFinding`'s `path` field is always an absolute path (resolved relative to `projectDir`). The CLI formatter shortens paths for display.
- Test convention: each check has a `positive` fixture (rule fires, finding count > 0) and a `negative` fixture (rule does not fire). Where useful, also a `transitive` fixture for rules with reachability semantics.
- Build core after every src change before running cli tests. The cli imports from `@tender/core`'s `dist/`.
- Test counts in this plan are approximate.

---

## Task 1: Define the report types

**Files:**
- Create: `packages/core/src/lint/report.ts`
- Create: `packages/core/src/lint/report.test.ts`

**Step 1: Write a small type-shape test**

The types are mostly compile-time, but a tiny structural test pins the exit-code semantics:

```ts
import { describe, it, expect } from "vitest";
import type { LintReport, LintFinding } from "./report.js";
import { hasFailures } from "./report.js";

describe("LintReport.hasFailures", () => {
  const f = (severity: LintFinding["severity"]): LintFinding => ({
    code: "tender/unused-component",
    severity,
    path: "/p/x.tender",
    message: "x"
  });

  it("returns true when there's any error", () => {
    const r: LintReport = { findings: [f("error"), f("info")] };
    expect(hasFailures(r, false)).toBe(true);
  });

  it("returns false when there are only warnings or info", () => {
    const r: LintReport = { findings: [f("warning"), f("info")] };
    expect(hasFailures(r, false)).toBe(false);
  });

  it("strict mode promotes warnings", () => {
    const r: LintReport = { findings: [f("warning")] };
    expect(hasFailures(r, true)).toBe(true);
  });

  it("strict mode does not promote info", () => {
    const r: LintReport = { findings: [f("info")] };
    expect(hasFailures(r, true)).toBe(false);
  });
});
```

**Step 2: Implement**

```ts
// packages/core/src/lint/report.ts
export type LintCode =
  | "tender/unused-component"
  | "tender/declared-slot-never-filled"
  | "tender/missing-asset"
  | "tender/deprecated-syntax";

export interface LintFinding {
  code: LintCode;
  severity: "error" | "warning" | "info";
  path: string;
  line?: number;
  column?: number;
  message: string;
  /** One-line suggestion for users; LSP can render as a Code Action later. */
  suggestion?: string;
}

export interface LintReport {
  findings: LintFinding[];
}

export function hasFailures(report: LintReport, strict: boolean): boolean {
  for (const f of report.findings) {
    if (f.severity === "error") return true;
    if (strict && f.severity === "warning") return true;
  }
  return false;
}
```

**Step 3: Run tests + commit**

```
pnpm --filter @tender/core test -- --run src/lint/report.test.ts
```

```
git add packages/core/src/lint/report.ts packages/core/src/lint/report.test.ts
git commit -m "$(cat <<'EOF'
feat(core): lint report types and exit-code policy (lint v1 step 1)

Adds the LintFinding/LintReport shapes plus a hasFailures(strict)
helper. Strict mode promotes warnings to failures (CI gating); info
findings never affect exit code.

The four-code union is closed for v1; future deferred checks
(orphan-css-class etc.) will widen it as they land.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Lint orchestrator skeleton

**Files:**
- Create: `packages/core/src/lint/index.ts`
- Create: `packages/core/src/lint/index.test.ts`
- Create: `packages/core/test/fixtures/lint/empty/` (a minimal valid project: project.yaml + content.md only)

**Step 1: Create the empty fixture**

```yaml
# packages/core/test/fixtures/lint/empty/project.yaml
page-templates:
  default: { size: A5, margin: 0 }
```

```markdown
# packages/core/test/fixtures/lint/empty/content.md
# Hello
```

**Step 2: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLint } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../test/fixtures/lint");

describe("runLint orchestrator", () => {
  it("returns an empty report for a project with no components and no content references", async () => {
    const report = await runLint(join(fixtures, "empty"));
    expect(report.findings).toEqual([]);
  });
});
```

**Step 3: Implement orchestrator skeleton**

```ts
// packages/core/src/lint/index.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProjectRegistry } from "../parse/load-project-registry.js";
import type { LintFinding, LintReport } from "./report.js";

export async function runLint(projectDir: string): Promise<LintReport> {
  const findings: LintFinding[] = [];
  const { config, registry } = await loadProjectRegistry(projectDir);
  const contentMd = await readFile(join(projectDir, "content.md"), "utf8")
    .catch(() => "");

  // Each check is wired in its own task.
  // findings.push(...checkUnusedComponent(...));
  // findings.push(...checkDeclaredSlotNeverFilled(...));
  // findings.push(...checkMissingAsset(...));
  // findings.push(...checkDeprecatedSyntax(...));

  // Carry registry/load diagnostics forward as info-level findings so the
  // user sees them in lint output (e.g. yaml-component deprecation).
  for (const d of registry.diagnostics) {
    findings.push({
      code: "tender/deprecated-syntax",
      severity: d.severity === "error" ? "error" : "info",
      path: d.source?.path ?? join(projectDir, "project.yaml"),
      message: d.message
    });
  }

  return { findings };
}
```

**Step 4: Run tests + commit**

```
pnpm --filter @tender/core test -- --run src/lint/index.test.ts
```

```
git add packages/core/src/lint/index.ts \
        packages/core/src/lint/index.test.ts \
        packages/core/test/fixtures/lint/empty/
git commit -m "$(cat <<'EOF'
feat(core): runLint orchestrator skeleton (lint v1 step 2)

Loads the project registry and content.md, returns an empty findings
list. Forwards registry-level deprecation diagnostics as info-level
findings so the user sees them in lint output.

The four check functions are wired in subsequent tasks. The empty
fixture pins the "no findings on a clean minimal project" baseline.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Check `tender/unused-component`

**Files:**
- Create: `packages/core/src/lint/checks/unused-component.ts`
- Create: `packages/core/src/lint/checks/unused-component.test.ts`
- Create fixtures:
  - `packages/core/test/fixtures/lint/unused-component-positive/`
  - `packages/core/test/fixtures/lint/unused-component-negative/`
  - `packages/core/test/fixtures/lint/unused-component-transitive/`

**Step 1: Build the fixtures**

`unused-component-positive/` — declares a component never referenced:

```
project.yaml:
  page-templates:
    default: { size: A5, margin: 0 }
content.md:
  # Hello
components/never-used.tender:
  ---
  tag: aside
  class: nope
  ---
```

`unused-component-negative/`:

```
content.md:
  # Hello
  <used>body</used>
components/used.tender:
  ---
  tag: aside
  ---
```

`unused-component-transitive/` — `outer` is used in content.md, `inner` is used only inside `outer`'s template:

```
content.md:
  <outer>x</outer>
components/outer.tender:
  ---
  ---
  <div><inner/></div>
components/inner.tender:
  ---
  ---
  <span>{{{body}}}</span>
```

Wait — `<inner/>` inside a template body is referenced. So this fixture should *not* produce a finding (transitive reachability). Add a different transitive case where the inner component is *also* unreachable:

`unused-component-transitive-unreachable/` — `outer` is also unused, and `inner` is referenced only by `outer`:

```
content.md:
  # No outer reference here
components/outer.tender:
  ---
  ---
  <div><inner/></div>
components/inner.tender:
  ---
  ---
  <span>{{{body}}}</span>
```

Both should fire as unused.

**Step 2: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLint } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../../test/fixtures/lint");

describe("tender/unused-component", () => {
  it("fires on a declared but unreferenced component", async () => {
    const r = await runLint(join(fixtures, "unused-component-positive"));
    const unused = r.findings.filter(f => f.code === "tender/unused-component");
    expect(unused.length).toBe(1);
    expect(unused[0]?.path).toMatch(/never-used\.tender$/);
    expect(unused[0]?.severity).toBe("warning");
  });

  it("does not fire on a referenced component", async () => {
    const r = await runLint(join(fixtures, "unused-component-negative"));
    expect(r.findings.filter(f => f.code === "tender/unused-component"))
      .toEqual([]);
  });

  it("does not fire transitively when an outer component references the inner", async () => {
    const r = await runLint(join(fixtures, "unused-component-transitive"));
    expect(r.findings.filter(f => f.code === "tender/unused-component"))
      .toEqual([]);
  });

  it("fires on both components when both are transitively unreachable", async () => {
    const r = await runLint(join(fixtures, "unused-component-transitive-unreachable"));
    const unused = r.findings.filter(f => f.code === "tender/unused-component");
    expect(unused.length).toBe(2);
    expect(unused.map(f => f.path).sort()).toEqual(
      [expect.stringMatching(/inner\.tender$/), expect.stringMatching(/outer\.tender$/)]
    );
  });

  it("never fires on the page built-in", async () => {
    // Even if no <page> appears anywhere, page is reachable as a built-in.
    const r = await runLint(join(fixtures, "unused-component-positive"));
    expect(r.findings.filter(f => f.message.includes("page"))).toEqual([]);
  });
});
```

**Step 3: Implement the check**

```ts
// packages/core/src/lint/checks/unused-component.ts
import { parseTags } from "@tender/language-server/dist/parsers/tag-parser.js";
import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";

const BUILTIN_NAMES = new Set(["page"]);

export interface UnusedComponentInput {
  registry: ComponentRegistry;
  contentMd: string;
}

export function checkUnusedComponent(input: UnusedComponentInput): LintFinding[] {
  const referenced = new Set<string>();

  // Seed: tag names referenced in content.md.
  const contentTags = parseTags(input.contentMd).tags;
  for (const t of contentTags) referenced.add(t.name);

  // Walk closures: a component's template body may reference other
  // components. Repeat until no new names get added.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of input.registry.byName) {
      if (!referenced.has(name)) continue;
      const body = entry.def.template ?? "";
      const tags = parseTags(body).tags;
      for (const t of tags) {
        if (!referenced.has(t.name)) {
          referenced.add(t.name);
          changed = true;
        }
      }
    }
  }

  const findings: LintFinding[] = [];
  for (const [name, entry] of input.registry.byName) {
    if (BUILTIN_NAMES.has(name)) continue;
    if (referenced.has(name)) continue;
    findings.push({
      code: "tender/unused-component",
      severity: "warning",
      path: entry.source.path,
      message: `Component "${name}" is declared but never used.`
    });
  }
  return findings;
}
```

Wait — importing from `@tender/language-server/dist/...` is a layering violation (core depends on language-server). Refactor: move the recovery `parseTags` to `@tender/core` (it's already exported via `tryParseTag`; the `parseTags` wrapper is the LSP module). Two options:

**Option A (cleaner):** add a tiny `parseTagNames(source: string): string[]` helper to core that lives in `parse/try-parse-tag.ts`. The lint check only needs names; it doesn't need ranges or diagnostics.

```ts
// in packages/core/src/parse/try-parse-tag.ts
export function parseTagNames(source: string): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] !== "<") { i++; continue; }
    const tag = tryParseTag(source, i);
    if (!tag) { i++; continue; }
    names.push(tag.name);
    i = tag.end;
  }
  return names;
}
```

This is what the unused-component check actually wants. It's also right for `deprecated-syntax`'s `:::name` scan if we add a similar helper there.

**Option B:** import `@tender/language-server`'s recovery parser into core as a dev dep. That's worse — circular at the workspace level.

Go with Option A. Update the unused-component check to use `parseTagNames`:

```ts
import { parseTagNames } from "../../parse/try-parse-tag.js";
// ...
const contentNames = parseTagNames(input.contentMd);
for (const name of contentNames) referenced.add(name);
```

**Step 4: Wire into orchestrator**

In `lint/index.ts`, add the call:

```ts
import { checkUnusedComponent } from "./checks/unused-component.js";
// ...
findings.push(...checkUnusedComponent({ registry, contentMd }));
```

**Step 5: Run tests + commit**

```
pnpm --filter @tender/core test -- --run src/lint/checks/unused-component.test.ts
```

```
git add packages/core/src/lint/checks/unused-component.ts \
        packages/core/src/lint/checks/unused-component.test.ts \
        packages/core/src/lint/index.ts \
        packages/core/src/parse/try-parse-tag.ts \
        packages/core/test/fixtures/lint/unused-component-{positive,negative,transitive,transitive-unreachable}/
git commit -m "$(cat <<'EOF'
feat(core): tender/unused-component lint check (lint v1 step 3)

Reachability-based: starts from tag references in content.md, walks
closures through component template bodies, marks each reached name.
Components not reached emit warnings pointing at their .tender file.

Built-in page is excluded — always reachable.

Adds parseTagNames() to packages/core/src/parse/try-parse-tag.ts to
keep the lint code in core without depending on the LSP package's
recovery parser.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Check `tender/declared-slot-never-filled`

**Files:**
- Create: `packages/core/src/lint/checks/declared-slot-never-filled.ts`
- Create: `packages/core/src/lint/checks/declared-slot-never-filled.test.ts`
- Create fixtures:
  - `lint/declared-slot-never-filled-positive/` — declares slot; no usage fills it
  - `lint/declared-slot-never-filled-negative/` — declares slot; usage fills it

**Step 1: Build fixtures**

Positive: a component declaring a slot that's never used in content.md or in another component:

```
project.yaml: minimal
content.md:
  # No usage at all
components/ad-lib.tender:
  ---
  slots: [suggested, response]
  ---
  <div>{{{suggested}}}{{{response}}}</div>
```

Both slots fire (since no `<ad-lib>` invocation exists at all). Hmm — that's actually the same as unused-component. To make the test isolate this check, the component itself must be reachable but not all its slots filled:

```
content.md:
  <ad-lib>
  @@ suggested

  Hello.
  </ad-lib>
components/ad-lib.tender:
  ---
  slots: [suggested, response]
  ---
  <div>{{{suggested}}}{{{response}}}</div>
```

Here `response` is declared but the only invocation only fills `suggested`. Expected: one finding for `response`. (Note: this would also fail at build time because the resolver requires every declared slot to be filled. The lint check fires on the broader population — it scans every invocation across the project; if at least one invocation fills the slot, no finding. The error-vs-warning distinction is "no usage anywhere fills it." For a project where a component is used multiple times and at least one fills the slot, no warning.)

Actually re-reading the design: "if a slot is declared but no invocation in the project's content fills it, flag the slot's declaration." Per-invocation slot filling is enforced by the build. The lint check is broader: across all invocations, this slot is never used. So the test fixture should have a usage that *succeeds* but doesn't fill `response`:

```
components/ad-lib.tender:
  ---
  slots: [suggested]
  optional-slots: [response]    # NOT a real schema field — just illustrative
  ---
```

Actually the build-time slot validator requires every declared slot. So a slot that's "declared but never filled" never passes the build. The check is really only useful for components that are *unused entirely* (which the unused-component check already catches) OR for finding inconsistencies between the design plan's `slots:` declaration and what `parseTags`-via-recovery sees inside template bodies.

Re-reading the design: "if a slot is declared but no invocation in the project's content fills it, flag the slot's declaration." If the build enforces all declared slots, this check rarely fires unless the component is unused. The check has limited value in v1.

**Decision:** descope this check from v1. Document that it's deferred to lint v2 alongside the CSS/HTML checks, because in the current schema "declared slot" implies "must-fill," so it's never legitimately empty.

Update the design doc (small edit) and the report.ts code union to drop `tender/declared-slot-never-filled`. Reduces task count from 4 to 3 implemented checks.

**Step 2: Update the design doc**

Edit `docs/plans/2026-05-09-tender-lint-v1-design.md`:

- Drop `tender/declared-slot-never-filled` from the v1 list.
- Add it to the "Out of scope for v1" section with a one-line explanation: "redundant with the build-time validator until we add optional slots."

**Step 3: Update `report.ts`**

Drop `tender/declared-slot-never-filled` from the `LintCode` union.

**Step 4: Commit the descoping**

```
git add docs/plans/2026-05-09-tender-lint-v1-design.md \
        packages/core/src/lint/report.ts
git commit -m "$(cat <<'EOF'
chore(plans): descope declared-slot-never-filled from lint v1

The build-time slot validator already enforces that every declared
slot be filled at every invocation. A "declared but never filled"
warning therefore only fires on components that are entirely unused
— which is exactly what tender/unused-component already catches.

Defer to lint v2 alongside the CSS/HTML-aware checks. If we ever add
"optional slots" to the schema, this check becomes useful.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Check `tender/missing-asset`

**Files:**
- Create: `packages/core/src/lint/checks/missing-asset.ts`
- Create: `packages/core/src/lint/checks/missing-asset.test.ts`
- Create fixtures: `lint/missing-asset-positive/`, `lint/missing-asset-negative/`

**Step 1: Build fixtures**

Positive: a component whose template references a non-existent asset:

```
project.yaml: minimal
content.md: # Hi
components/cover-spiral.tender:
  ---
  ---
  <div class="cover-spiral"><img src="assets/images/spiral.png" alt=""></div>
# Note: no assets/images/spiral.png file
```

Plus a content.md reference variant:

```
content.md:
  ![alt](assets/images/missing.png)
```

Negative: same components, but with the assets present.

**Step 2: Write the test**

```ts
import { describe, it, expect } from "vitest";
// ...

describe("tender/missing-asset", () => {
  it("fires on a relative reference to a non-existent file", async () => {
    const r = await runLint(join(fixtures, "missing-asset-positive"));
    const missing = r.findings.filter(f => f.code === "tender/missing-asset");
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0]?.severity).toBe("error");
    expect(missing[0]?.message).toMatch(/spiral\.png/);
  });

  it("does not fire when the asset exists", async () => {
    const r = await runLint(join(fixtures, "missing-asset-negative"));
    expect(r.findings.filter(f => f.code === "tender/missing-asset"))
      .toEqual([]);
  });

  it("does not flag http(s) or data: URIs", async () => {
    // Embedded in negative fixture or new one: <img src="https://example.com/x.png">
    // ...
  });
});
```

**Step 3: Implement**

```ts
// packages/core/src/lint/checks/missing-asset.ts
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";

const SRC_ATTR_RE = /(?:src|href)\s*=\s*"([^"]+)"|(?:src|href)\s*=\s*'([^']+)'/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;
const SKIPPED_PROTOCOLS = /^(?:https?:|data:|mailto:|#)/;

export interface MissingAssetInput {
  projectDir: string;
  registry: ComponentRegistry;
  contentMd: string;
}

export async function checkMissingAsset(input: MissingAssetInput): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];

  // Scan component templates.
  for (const [name, entry] of input.registry.byName) {
    const body = entry.def.template ?? "";
    const refs = collectRefs(body);
    for (const ref of refs) {
      if (SKIPPED_PROTOCOLS.test(ref)) continue;
      const refPath = isAbsolute(ref) ? ref : join(input.projectDir, ref);
      const exists = await stat(refPath).then(() => true).catch(() => false);
      if (!exists) {
        findings.push({
          code: "tender/missing-asset",
          severity: "error",
          path: entry.source.path,
          message: `Component "${name}" references missing asset "${ref}".`
        });
      }
    }
  }

  // Scan content.md for Markdown image refs.
  for (const m of input.contentMd.matchAll(MD_IMAGE_RE)) {
    const ref = m[1]!;
    if (SKIPPED_PROTOCOLS.test(ref)) continue;
    const refPath = isAbsolute(ref) ? ref : join(input.projectDir, ref);
    const exists = await stat(refPath).then(() => true).catch(() => false);
    if (!exists) {
      findings.push({
        code: "tender/missing-asset",
        severity: "error",
        path: join(input.projectDir, "content.md"),
        message: `Missing asset "${ref}".`
      });
    }
  }
  return findings;
}

function collectRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(SRC_ATTR_RE)) {
    out.push(m[1] ?? m[2]!);
  }
  return out;
}
```

**Step 4: Wire + commit**

```
git add packages/core/src/lint/checks/missing-asset.ts \
        packages/core/src/lint/checks/missing-asset.test.ts \
        packages/core/src/lint/index.ts \
        packages/core/test/fixtures/lint/missing-asset-{positive,negative}/
git commit -m "$(cat <<'EOF'
feat(core): tender/missing-asset lint check (lint v1 step 4)

Walks component template src= and href= attributes plus content.md
markdown image references. Relative paths resolve against projectDir;
http(s)/data:/mailto:/#anchor skipped. Missing files emit error-
level findings.

Handlebars-templated paths (e.g. assets/{{icon}}.png) are not
resolved — that's a v2 concern.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Check `tender/deprecated-syntax`

**Files:**
- Create: `packages/core/src/lint/checks/deprecated-syntax.ts`
- Create: `packages/core/src/lint/checks/deprecated-syntax.test.ts`
- Create fixtures: `lint/deprecated-syntax-positive/`, `lint/deprecated-syntax-negative/`

**Step 1: Build fixtures**

Positive — uses every deprecated form:

```
project.yaml:
  page-templates:
    default: { size: A5, margin: 0 }
  templates:                     # deprecated
    row:
      template: <div>{{{body}}}</div>

content.md:
  :::row
  body
  :::

  Some text

  --- response ---            # appears as a slot marker (deprecated)

components/something.tender:
  ---
  ---
  <span>x</span>
```

Wait — the legacy YAML `templates:` block is *already migrated* by `loadProjectConfig` and surfaces as a registry diagnostic. The `runLint` orchestrator already forwards those as info-level findings (Task 2). So the deprecated-syntax check shouldn't double-flag YAML `templates:` — that's already covered.

Refine: the deprecated-syntax check focuses on:

1. `:::name` directive form in content.md (and component template bodies).
2. `--- name ---` slot markers in content.md and template bodies.

Both are info-level with one-line suggestions.

Negative — uses `<row>...</row>` and `@@ name`:

```
content.md:
  <row>body</row>

components/something.tender:
  ---
  ---
  <span>x</span>
```

**Step 2: Write the test**

```ts
describe("tender/deprecated-syntax", () => {
  it("flags :::name directive in content.md", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-positive"));
    const dep = r.findings.filter(f => f.code === "tender/deprecated-syntax");
    expect(dep.some(f => /:::row|directive/.test(f.message))).toBe(true);
  });

  it("flags --- slot --- markers in content.md", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-positive"));
    const dep = r.findings.filter(f => f.code === "tender/deprecated-syntax");
    expect(dep.some(f => /response|@@/.test(f.suggestion ?? ""))).toBe(true);
  });

  it("emits info severity (not error)", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-positive"));
    const dep = r.findings.filter(f => f.code === "tender/deprecated-syntax");
    expect(dep.every(f => f.severity === "info")).toBe(true);
  });

  it("does not fire on a project using the new syntax", async () => {
    const r = await runLint(join(fixtures, "deprecated-syntax-negative"));
    expect(r.findings.filter(f => f.code === "tender/deprecated-syntax"))
      .toEqual([]);
  });
});
```

**Step 3: Implement**

```ts
// packages/core/src/lint/checks/deprecated-syntax.ts
import type { ComponentRegistry } from "../../parse/load-components-dir.js";
import type { LintFinding } from "../report.js";
import { join } from "node:path";

const DIRECTIVE_RE = /^:::([\w-]+)/gm;
const LEGACY_SLOT_RE = /^---\s+([\w-]+)\s+---\s*$/gm;

export interface DeprecatedSyntaxInput {
  projectDir: string;
  registry: ComponentRegistry;
  contentMd: string;
}

export function checkDeprecatedSyntax(input: DeprecatedSyntaxInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const contentPath = join(input.projectDir, "content.md");

  // 1. :::name directives in content.md.
  for (const m of input.contentMd.matchAll(DIRECTIVE_RE)) {
    const lineNum = lineOf(input.contentMd, m.index ?? 0);
    findings.push({
      code: "tender/deprecated-syntax",
      severity: "info",
      path: contentPath,
      line: lineNum,
      message: `Deprecated directive form ":::${m[1]}".`,
      suggestion: `Use <${m[1]} ...>...</${m[1]}> instead.`
    });
  }

  // 2. Legacy slot markers in content.md.
  for (const m of input.contentMd.matchAll(LEGACY_SLOT_RE)) {
    const lineNum = lineOf(input.contentMd, m.index ?? 0);
    findings.push({
      code: "tender/deprecated-syntax",
      severity: "info",
      path: contentPath,
      line: lineNum,
      message: `Deprecated slot marker "--- ${m[1]} ---".`,
      suggestion: `Use @@ ${m[1]} instead.`
    });
  }

  // 3. Same scans across component template bodies.
  for (const [name, entry] of input.registry.byName) {
    const body = entry.def.template ?? "";
    for (const m of body.matchAll(DIRECTIVE_RE)) {
      findings.push({
        code: "tender/deprecated-syntax",
        severity: "info",
        path: entry.source.path,
        message: `Deprecated directive form ":::${m[1]}" inside component "${name}".`,
        suggestion: `Use <${m[1]} ...>...</${m[1]}> instead.`
      });
    }
    for (const m of body.matchAll(LEGACY_SLOT_RE)) {
      findings.push({
        code: "tender/deprecated-syntax",
        severity: "info",
        path: entry.source.path,
        message: `Deprecated slot marker inside component "${name}".`,
        suggestion: `Use @@ ${m[1]} instead.`
      });
    }
  }

  return findings;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}
```

**Step 4: Wire + commit**

```
git add packages/core/src/lint/checks/deprecated-syntax.ts \
        packages/core/src/lint/checks/deprecated-syntax.test.ts \
        packages/core/src/lint/index.ts \
        packages/core/test/fixtures/lint/deprecated-syntax-{positive,negative}/
git commit -m "$(cat <<'EOF'
feat(core): tender/deprecated-syntax lint check (lint v1 step 5)

Info-level findings for two deprecated forms in content.md and
component template bodies:

- :::name directives → suggest <name>...</name>
- --- slot --- markers → suggest @@ slot

The legacy YAML `templates:` block is also deprecated, but that
diagnostic surfaces from loadProjectRegistry directly and is forwarded
by the orchestrator (Task 2).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: CLI `tender lint` command rewrite

**Files:**
- Modify: `packages/cli/src/commands/lint.ts`
- Modify: `packages/cli/src/commands/lint.test.ts`
- Modify: `packages/cli/src/cli.ts` (extend the `tender lint` argparse)

**Step 1: Extend the command**

```ts
// packages/cli/src/commands/lint.ts
import { runLint } from "@tender/core";
import { hasFailures } from "@tender/core";
import type { LintReport, LintFinding } from "@tender/core";

export interface LintCliOptions {
  strict?: boolean;
  json?: boolean;
}

export async function lint(
  projectDir: string,
  opts: LintCliOptions = {}
): Promise<{ report: LintReport; exitCode: number }> {
  const report = await runLint(projectDir);
  const exitCode = hasFailures(report, !!opts.strict) ? 1 : 0;
  return { report, exitCode };
}

export function formatReport(report: LintReport, projectDir: string): string {
  const lines: string[] = [];
  let counts = { error: 0, warning: 0, info: 0 };
  for (const f of report.findings) {
    counts[f.severity]++;
    const path = relPath(f.path, projectDir);
    const loc = f.line ? `:${f.line}${f.column ? ":" + f.column : ""}` : "";
    lines.push(`${pad(f.severity)}: ${path}${loc}: ${f.message} [${f.code}]`);
    if (f.suggestion) {
      lines.push(`         suggestion: ${f.suggestion}`);
    }
  }
  if (report.findings.length === 0) {
    lines.push("ok");
  } else {
    lines.push("");
    lines.push(
      `${counts.error} errors, ${counts.warning} warnings, ${counts.info} info.`
    );
  }
  return lines.join("\n");
}

function pad(severity: LintFinding["severity"]): string {
  return severity === "error"
    ? "error  "
    : severity === "warning"
    ? "warning"
    : "info   ";
}

function relPath(absolute: string, projectDir: string): string {
  if (absolute.startsWith(projectDir + "/")) return absolute.slice(projectDir.length + 1);
  return absolute;
}
```

Export `runLint`, `hasFailures`, the types, and the `formatReport` helper from `@tender/core`'s `index.ts`. (Add a `export { runLint } from "./lint/index.js";` etc.)

**Step 2: Wire the CLI flags**

In `cli.ts`, replace the `tender lint` block:

```ts
program.command("lint [dir]")
  .description("Validate a project's content; surface deprecated syntax, unused components, and missing assets")
  .option("--strict", "promote warnings to errors for CI gating")
  .option("--json", "emit findings as JSON")
  .action(async (dir, opts) => {
    const { report, exitCode } = await lint(resolve(dir ?? "."), opts);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatReport(report, resolve(dir ?? ".")));
    }
    if (exitCode !== 0) process.exit(exitCode);
  });
```

Import `formatReport` from `./commands/lint.js`.

**Step 3: Update CLI tests**

Adapt `lint.test.ts` to assert the new shape — call `lint(projectDir, { strict, json })` and inspect the `report.findings` array. Add cases for `--strict` and `--json` shapes.

**Step 4: Run tests + commit**

```
pnpm -r build && pnpm test
```

```
git add packages/cli/src/commands/lint.ts \
        packages/cli/src/commands/lint.test.ts \
        packages/cli/src/cli.ts \
        packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): tender lint v1 with --strict and --json (lint v1 step 6)

Replaces the existing one-line `tender lint` wrapper with a
structured command that runs the four v1 lint checks via the new
@tender/core lint/ module group. Output:

- Default: human-readable list grouped by severity, with file:line
  prefixes and suggestion underlines.
- --json: emits the LintReport as JSON for editor integrations.
- --strict: promotes warnings to errors for CI gating.

Exit code: 0 on no errors (warnings allowed); 1 when errors are
present (or any warnings under --strict).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Integration assertion against the migrated coastal-planet-tags fixture

**Files:**
- Modify: `packages/cli/src/commands/lint.test.ts`

**Step 1: Add an assertion**

After items 4–6 land and migrate the `coastal-planet-tags` fixture to the new syntax, lint should produce zero findings (modulo missing assets if any — assume the fixture has all its assets present).

```ts
it("coastal-planet-tags fixture: no lint findings on the post-migration content", async () => {
  const { report } = await lint(
    join(fixturesDir, "coastal-planet-tags"),
    {}
  );
  // Print findings for diagnostic if it fails:
  if (report.findings.length > 0) {
    console.error("Unexpected findings:", report.findings);
  }
  expect(report.findings).toEqual([]);
});
```

**Step 2: Run + commit**

```
pnpm -r build && pnpm test
```

```
git add packages/cli/src/commands/lint.test.ts
git commit -m "$(cat <<'EOF'
test(cli): assert coastal-planet-tags is lint-clean (lint v1 step 7)

Pins the post-migration fixture as a regression target for the four
v1 lint checks. Any future deprecated form (or missing asset, etc.)
that creeps into our reference fixture fails this test.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Done criteria

`tender lint` v1 is complete when:

1. The four checks are implemented (or three, after Task 4 descopes one): unused-component, missing-asset, deprecated-syntax. (The descoped check joins the deferred GH issue.)
2. Each check has positive and negative test fixtures.
3. `tender lint --strict` and `tender lint --json` work as documented.
4. `tender lint coastal-planet-tags` produces zero findings.
5. All workspace tests + typecheck green.
6. GitHub issues filed for the deferred checks (per the user's instruction set).

Total task count: 8.
