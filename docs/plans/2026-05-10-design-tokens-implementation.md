# Design Tokens Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `design-tokens:` block to `project.yaml` that compiles to CSS custom properties under `:root`, with lint coverage and a `tender tokens` CLI (list / set / minimal interactive edit).

**Architecture:**
- **Schema** lives in `packages/core/src/config/schema.ts` as a new top-level field `design-tokens`. Categorised: open-ended group names → token name → leaf value (string or number).
- **Compile** is one new helper in `packages/core/src/compose/project-css.ts` (`emitTokensRoot`), called as the first append in `generateProjectCss()`. Generated `:root` rule loads before `styles.css`, so user CSS wins on conflicts (the documented escape hatch).
- **Lint** adds three new checks under `packages/core/src/lint/checks/tokens.ts`. Light-touch value-shape validation only runs for known categories (`color`/`size`/`space`/`leading`/`weight`); unknown categories pass through. Unused tokens are info-level (mention, don't scold).
- **CLI** adds `packages/cli/src/commands/tokens.ts` with three subcommands (`list`, `set`, `edit`). `set` round-trips through the `yaml` npm package's AST (preserves comments); `edit` is a minimal raw-mode `readline` picker.

**Tech Stack:** TypeScript, Zod (schema), Vitest (tests), `yaml` package (CLI AST round-trip — new dependency in `packages/cli`), Node `readline` (interactive edit; no new deps).

**References:**
- Design doc: `docs/plans/2026-05-10-design-tokens-design.md`
- CLI style guide: `packages/cli/src/ui/README.md` (color/banner/spinner conventions)
- Coastal fixture (north star): `packages/core/test/fixtures/coastal-planet-tags/`

**Test posture:** TDD throughout. Each task starts with a failing test, then minimal implementation, then commit. Vitest runs in non-TTY mode so `style.ts` color helpers are pass-through — assert plain text.

---

## Phase 1 — Schema + compile

### Task 1: Add `design-tokens` to the Zod schema

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Test: `packages/core/src/config/schema.test.ts`

**Step 1: Write the failing test**

Append to `schema.test.ts`:

```ts
describe("design-tokens", () => {
  it("accepts categorised tokens with string and number leaves", () => {
    const cfg = ProjectConfig.parse({
      "page-templates": { default: { size: "A4", margin: 0 } },
      "design-tokens": {
        color: { ink: "#1a1a1a", accent: "#FFE600" },
        size: { h1: "24pt", body: "12pt" },
        leading: { body: 1.6 }
      }
    });
    expect(cfg["design-tokens"]?.color?.ink).toBe("#1a1a1a");
    expect(cfg["design-tokens"]?.leading?.body).toBe(1.6);
  });

  it("rejects category names that don't match [a-z][a-z0-9-]*", () => {
    expect(() => ProjectConfig.parse({
      "page-templates": { default: { size: "A4", margin: 0 } },
      "design-tokens": { Color: { ink: "#000" } }
    })).toThrow();
  });

  it("rejects token names that don't match [a-z][a-z0-9-]*", () => {
    expect(() => ProjectConfig.parse({
      "page-templates": { default: { size: "A4", margin: 0 } },
      "design-tokens": { color: { Ink: "#000" } }
    })).toThrow();
  });

  it("design-tokens is optional", () => {
    const cfg = ProjectConfig.parse({
      "page-templates": { default: { size: "A4", margin: 0 } }
    });
    expect(cfg["design-tokens"]).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```
pnpm --filter @tender/core test -- schema.test.ts
```
Expected: 4 new failures.

**Step 3: Implement minimal schema**

In `schema.ts`, add before `ProjectConfig`:

```ts
const TokenIdent = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message: "must be lowercase, hyphenated (matching /^[a-z][a-z0-9-]*$/)"
});

const TokenValue = z.union([z.string(), z.number()]);

const TokenGroup = z.record(TokenIdent, TokenValue);

const DesignTokens = z.record(TokenIdent, TokenGroup);
```

In the `ProjectConfig` object, add:

```ts
"design-tokens": DesignTokens.optional(),
```

**Step 4: Run test to verify it passes**

```
pnpm --filter @tender/core test -- schema.test.ts
```
Expected: all schema tests pass; rest of suite green.

**Step 5: Commit**

```bash
git add packages/core/src/config/schema.ts packages/core/src/config/schema.test.ts
git commit -m "feat(core): design-tokens schema (categorised, lowercase-hyphenated)"
```

---

### Task 2: Implement `emitTokensRoot` compile helper

**Files:**
- Modify: `packages/core/src/compose/project-css.ts`
- Test: `packages/core/src/compose/project-css.test.ts`

**Step 1: Write the failing test**

Append to `project-css.test.ts`:

```ts
describe("design-tokens compile", () => {
  it("emits a :root block with --category-name custom properties", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A4", margin: 0 } },
      "design-tokens": {
        color: { ink: "#1a1a1a", accent: "#FFE600" },
        size: { h1: "24pt" },
        leading: { body: 1.6 }
      }
    } as never);
    expect(css).toContain(":root {");
    expect(css).toContain("--color-ink: #1a1a1a;");
    expect(css).toContain("--color-accent: #FFE600;");
    expect(css).toContain("--size-h1: 24pt;");
    expect(css).toContain("--leading-body: 1.6;");
  });

  it("emits :root before @page rules", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A4", margin: 0 } },
      "design-tokens": { color: { ink: "#000" } }
    } as never);
    const rootIdx = css.indexOf(":root {");
    const pageIdx = css.indexOf("@page");
    expect(rootIdx).toBeGreaterThanOrEqual(0);
    expect(pageIdx).toBeGreaterThan(rootIdx);
  });

  it("omits :root when design-tokens is absent", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A4", margin: 0 } }
    } as never);
    expect(css).not.toContain(":root {");
  });

  it("omits :root when design-tokens is empty", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A4", margin: 0 } },
      "design-tokens": {}
    } as never);
    expect(css).not.toContain(":root {");
  });
});
```

**Step 2: Run test to verify it fails**

```
pnpm --filter @tender/core test -- project-css.test.ts
```
Expected: 4 new failures.

**Step 3: Implement `emitTokensRoot`**

In `project-css.ts`, add this helper above `generateProjectCss`:

```ts
function emitTokensRoot(tokens: ProjectConfig["design-tokens"]): string {
  if (!tokens) return "";
  const lines: string[] = [];
  for (const [category, group] of Object.entries(tokens)) {
    if (!group) continue;
    for (const [name, value] of Object.entries(group)) {
      lines.push(`  --${category}-${name}: ${value};`);
    }
  }
  if (lines.length === 0) return "";
  return [":root {", ...lines, "}"].join("\n");
}
```

In `generateProjectCss`, prepend the tokens block as the first part:

```ts
export function generateProjectCss(config: ProjectConfig, opts: ProjectCssOptions = {}): string {
  const parts: string[] = [];

  const tokensRoot = emitTokensRoot(config["design-tokens"]);
  if (tokensRoot) parts.push(tokensRoot);

  // …existing code: fonts, page templates, etc.
```

**Step 4: Run test to verify it passes**

```
pnpm --filter @tender/core test -- project-css.test.ts
```
Expected: all tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/compose/project-css.ts packages/core/src/compose/project-css.test.ts
git commit -m "feat(core): compile design-tokens to :root custom properties"
```

---

### Task 3: End-to-end build smoke test

**Files:**
- Create: `packages/core/test/fixtures/design-tokens/project.yaml`
- Create: `packages/core/test/fixtures/design-tokens/styles.css`
- Create: `packages/core/test/fixtures/design-tokens/content.md`
- Modify: `packages/core/src/build.test.ts`

**Step 1: Create fixture**

`project.yaml`:
```yaml
page-templates:
  default: { size: A5, margin: 12mm }

design-tokens:
  color:
    ink: '#1a1a1a'
    page: '#ffffff'
  size:
    body: 11pt
```

`styles.css`:
```css
body {
  color: var(--color-ink);
  background: var(--color-page);
  font-size: var(--size-body);
}
```

`content.md`:
```markdown
# Tokens fixture

Body copy uses tokens.
```

**Step 2: Add a build-level test**

Append to `build.test.ts`:

```ts
it("design-tokens fixture: tokens appear in projectCss before user styles", async () => {
  const result = await buildProject(join(here, "../test/fixtures/design-tokens"));
  expect(result.projectCss).toContain("--color-ink: #1a1a1a;");
  expect(result.projectCss).toContain("--color-page: #ffffff;");
  expect(result.projectCss).toContain("--size-body: 11pt;");
  // user CSS is separate — its var() references are preserved verbatim
  expect(result.stylesCss).toContain("var(--color-ink)");
});
```

(Adjust path resolution to match the existing pattern in `build.test.ts`.)

**Step 3: Run test, verify pass**

```
pnpm --filter @tender/core test -- build.test.ts
```
Expected: pass.

**Step 4: Commit**

```bash
git add packages/core/test/fixtures/design-tokens/ packages/core/src/build.test.ts
git commit -m "test(core): end-to-end fixture for design-tokens compile"
```

---

## Phase 2 — Lint rules

### Task 4: `tender/token-name-invalid` (error)

This is mostly redundant with the schema rejection from Task 1, but it needs to surface as a lint finding (with file:line) rather than a thrown schema error, so users see structured feedback in `tender lint --json`. The trick is that the schema rejects bad names at parse time before lint runs. The clean solution: schema-level rejection IS the source of these errors — they surface via `loadProjectConfig` throwing, which `runLint` already catches and forwards via the registry's `diagnostics`. So this task verifies the wiring rather than adding new code.

**Files:**
- Create: `packages/core/test/fixtures/lint/tokens-invalid-name/project.yaml`
- Modify: `packages/core/src/lint/index.ts` (only if the wiring needs adjustment)
- Test: `packages/core/src/lint/index.test.ts` (or a new `tokens-name.test.ts`)

**Step 1: Create the negative fixture**

`packages/core/test/fixtures/lint/tokens-invalid-name/project.yaml`:
```yaml
page-templates:
  default: { size: A5, margin: 0 }

design-tokens:
  Color:    # invalid — uppercase
    ink: '#000'
```

**Step 2: Write a test that asserts a lint error is reported**

Append to `lint/index.test.ts`:

```ts
it("surfaces invalid token category names as lint errors", async () => {
  const report = await runLint(
    join(here, "../../test/fixtures/lint/tokens-invalid-name")
  );
  const errs = report.findings.filter(f => f.severity === "error");
  expect(errs.length).toBeGreaterThan(0);
  expect(errs[0].message.toLowerCase()).toContain("token");
});
```

**Step 3: Run test to verify failure mode**

```
pnpm --filter @tender/core test -- lint/index.test.ts
```

Expected: depending on how `loadProjectConfig` handles the schema error, it may either throw (not get reported as a lint finding) or surface via `registry.diagnostics`. If it throws, runLint will need a try/catch that converts a project-config-load failure into a lint finding with code `tender/project-config`. Implement that.

**Step 4: If needed, implement the catch**

If the test fails because `runLint` throws, wrap `loadProjectRegistry`:

```ts
let registry;
try {
  ({ registry } = await loadProjectRegistry(projectDir));
} catch (err) {
  return {
    findings: [{
      code: "tender/project-config",
      severity: "error",
      path: join(projectDir, "project.yaml"),
      message: err instanceof Error ? err.message : String(err)
    }]
  };
}
```

(Keep this minimal — the broader treatment of project-config errors is its own design call.)

**Step 5: Run test, verify pass; run full suite**

```
pnpm --filter @tender/core test
```

**Step 6: Commit**

```bash
git add packages/core/test/fixtures/lint/tokens-invalid-name/ packages/core/src/lint/index.ts packages/core/src/lint/index.test.ts
git commit -m "feat(lint): surface project.yaml schema errors as lint findings"
```

---

### Task 5: `tender/token-value-shape` (warning) — color category

**Files:**
- Create: `packages/core/src/lint/checks/tokens.ts`
- Create: `packages/core/src/lint/checks/tokens.test.ts`
- Create: `packages/core/test/fixtures/lint/tokens-bad-color/project.yaml`
- Modify: `packages/core/src/lint/index.ts` (register the new check)

**Step 1: Create the negative fixture**

`tokens-bad-color/project.yaml`:
```yaml
page-templates:
  default: { size: A5, margin: 0 }

design-tokens:
  color:
    ink: '#1a1a1a'        # valid
    accent: 'mauveish'    # invalid — not a CSS color
```

**Step 2: Write the failing test**

`packages/core/src/lint/checks/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkTokens } from "./tokens.js";

describe("checkTokens — value shape", () => {
  it("flags a non-CSS color string as warning", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { color: { ink: "#1a1a1a", accent: "mauveish" } }
    });
    const warns = findings.filter(f => f.severity === "warning");
    expect(warns.length).toBe(1);
    expect(warns[0].message).toContain("accent");
    expect(warns[0].code).toBe("tender/token-value-shape");
  });

  it("accepts hex, rgb(), hsl(), and CSS named colors", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: {
        color: {
          a: "#fff", b: "#ffffff", c: "#ffffff80",
          d: "rgb(0, 0, 0)", e: "rgba(0, 0, 0, 0.5)",
          f: "hsl(0, 0%, 0%)", g: "hsla(0, 0%, 0%, 0.5)",
          h: "rebeccapurple"
        }
      }
    });
    expect(findings).toEqual([]);
  });

  it("ignores unknown categories (no value-shape check)", () => {
    const findings = checkTokens({
      projectDir: "/p",
      tokens: { vibe: { mood: "chill" } }
    });
    expect(findings).toEqual([]);
  });
});
```

**Step 3: Run test, verify failure**

```
pnpm --filter @tender/core test -- tokens.test.ts
```
Expected: import error (file doesn't exist).

**Step 4: Implement `checkTokens`**

`packages/core/src/lint/checks/tokens.ts`:

```ts
import { join } from "node:path";
import type { LintFinding } from "../report.js";
import type { ProjectConfig } from "../../config/schema.js";

export interface TokensCheckInput {
  projectDir: string;
  tokens: ProjectConfig["design-tokens"];
}

const CSS_NAMED_COLORS = new Set([
  // Pragmatic subset — common ones. Authors can use any value with the
  // CSS color() function or hex; named colors are the typo-prone shape.
  "black", "white", "red", "green", "blue", "yellow", "cyan", "magenta",
  "gray", "grey", "silver", "maroon", "olive", "lime", "aqua", "teal",
  "navy", "fuchsia", "purple", "orange", "pink", "brown", "rebeccapurple",
  "transparent", "currentcolor", "inherit", "initial", "unset"
]);

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_RE = /^(rgb|rgba|hsl|hsla|color|oklch|lch|lab)\(.+\)$/;
const LENGTH_RE = /^-?\d+(\.\d+)?(mm|cm|in|pt|px|em|rem)$/;

function isValidColor(v: string): boolean {
  if (HEX_RE.test(v)) return true;
  if (FUNC_RE.test(v)) return true;
  if (CSS_NAMED_COLORS.has(v.toLowerCase())) return true;
  return false;
}

function isValidLength(v: string): boolean {
  if (v === "0") return true;
  return LENGTH_RE.test(v);
}

function isValidLeading(v: string | number): boolean {
  if (typeof v === "number") return true;
  return /^-?\d+(\.\d+)?$/.test(v);
}

const VALID_WEIGHTS = new Set([
  "normal", "bold", "lighter", "bolder",
  "100", "200", "300", "400", "500", "600", "700", "800", "900"
]);

function isValidWeight(v: string | number): boolean {
  return VALID_WEIGHTS.has(String(v));
}

export function checkTokens(input: TokensCheckInput): LintFinding[] {
  const findings: LintFinding[] = [];
  if (!input.tokens) return findings;
  const path = join(input.projectDir, "project.yaml");

  for (const [category, group] of Object.entries(input.tokens)) {
    if (!group) continue;
    for (const [name, value] of Object.entries(group)) {
      const ref = `${category}.${name}`;
      const v = String(value);
      let ok = true;
      let expected: string | null = null;
      if (category === "color") {
        if (!isValidColor(v)) {
          ok = false;
          expected = "a CSS color (hex, rgb()/hsl()/oklch(), or a named color)";
        }
      } else if (category === "size" || category === "space") {
        if (!isValidLength(v)) {
          ok = false;
          expected = "a CSS length (e.g. 12pt, 8mm, 1em) or 0";
        }
      } else if (category === "leading") {
        if (!isValidLeading(value)) {
          ok = false;
          expected = "a unitless number";
        }
      } else if (category === "weight") {
        if (!isValidWeight(value)) {
          ok = false;
          expected = "a CSS font-weight (100–900 in 100s, normal, bold)";
        }
      }
      if (!ok) {
        findings.push({
          code: "tender/token-value-shape",
          severity: "warning",
          path,
          message: `Token "${ref}" value ${JSON.stringify(value)} doesn't look like ${expected}.`
        });
      }
    }
  }
  return findings;
}
```

**Step 5: Wire into `runLint`**

In `lint/index.ts`:

```ts
import { checkTokens } from "./checks/tokens.js";
// …
const config = registry.config; // adjust if `runLint` doesn't already have it
findings.push(...checkTokens({ projectDir, tokens: config["design-tokens"] }));
```

(If `runLint` doesn't currently surface `config`, expose it through `loadProjectRegistry`'s return — already does via `ProjectRegistry.config`. Use that.)

**Step 6: Run tests, verify pass**

```
pnpm --filter @tender/core test
```

**Step 7: Commit**

```bash
git add packages/core/src/lint/checks/tokens.ts packages/core/src/lint/checks/tokens.test.ts packages/core/test/fixtures/lint/tokens-bad-color/ packages/core/src/lint/index.ts
git commit -m "feat(lint): tender/token-value-shape — color values"
```

---

### Task 6: `tender/token-value-shape` for size/space, leading, weight

**Files:**
- Modify: `packages/core/src/lint/checks/tokens.test.ts`
- Create: `packages/core/test/fixtures/lint/tokens-bad-length/project.yaml`

**Step 1: Add tests for the remaining shapes**

```ts
it("flags non-length size/space values", () => {
  const findings = checkTokens({
    projectDir: "/p",
    tokens: { size: { h1: "huge" }, space: { gap: "wide" } }
  });
  expect(findings.length).toBe(2);
  expect(findings.every(f => f.code === "tender/token-value-shape")).toBe(true);
});

it("accepts CSS lengths and zero", () => {
  const findings = checkTokens({
    projectDir: "/p",
    tokens: { size: { a: "12pt", b: "8mm", c: "1em", d: "0" } }
  });
  expect(findings).toEqual([]);
});

it("flags non-numeric leading", () => {
  const findings = checkTokens({
    projectDir: "/p",
    tokens: { leading: { body: "1.6em" } }
  });
  expect(findings.length).toBe(1);
});

it("flags invalid font-weight", () => {
  const findings = checkTokens({
    projectDir: "/p",
    tokens: { weight: { body: "kinda-bold" } }
  });
  expect(findings.length).toBe(1);
});
```

**Step 2: Run, verify pass** (the implementation from Task 5 already covers these).

**Step 3: Commit**

```bash
git add packages/core/src/lint/checks/tokens.test.ts
git commit -m "test(lint): token-value-shape covers size/space/leading/weight"
```

---

### Task 7: `tender/token-unused` (info)

**Files:**
- Modify: `packages/core/src/lint/checks/tokens.ts`
- Modify: `packages/core/src/lint/checks/tokens.test.ts`
- Modify: `packages/core/src/lint/index.ts` (pass styles+components CSS)

**Step 1: Test**

```ts
it("flags tokens declared but never referenced as info", () => {
  const findings = checkTokens({
    projectDir: "/p",
    tokens: { color: { used: "#000", lonely: "#fff" } },
    consumedCss: "body { color: var(--color-used); }"
  });
  const unused = findings.filter(f => f.code === "tender/token-unused");
  expect(unused.length).toBe(1);
  expect(unused[0].severity).toBe("info");
  expect(unused[0].message).toContain("color.lonely");
});

it("recognises tokens used in component <style> blocks", () => {
  const findings = checkTokens({
    projectDir: "/p",
    tokens: { color: { ink: "#000" } },
    consumedCss: ".callout { border-color: var(--color-ink); }"
  });
  expect(findings.filter(f => f.code === "tender/token-unused")).toEqual([]);
});
```

**Step 2: Extend the input shape and check function**

In `tokens.ts`:

```ts
export interface TokensCheckInput {
  projectDir: string;
  tokens: ProjectConfig["design-tokens"];
  /** All CSS that may consume tokens: styles.css + every component's <style> block. */
  consumedCss?: string;
}
```

After the value-shape loop, add:

```ts
if (input.consumedCss !== undefined && input.tokens) {
  const css = input.consumedCss;
  for (const [category, group] of Object.entries(input.tokens)) {
    if (!group) continue;
    for (const name of Object.keys(group)) {
      const cssVar = `--${category}-${name}`;
      if (!css.includes(cssVar)) {
        findings.push({
          code: "tender/token-unused",
          severity: "info",
          path,
          message: `Token "${category}.${name}" is declared but never referenced as var(${cssVar}).`
        });
      }
    }
  }
}
```

**Step 3: Wire `consumedCss` from `runLint`**

In `lint/index.ts`, gather the styles.css and component CSS:

```ts
const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
const componentsCss = Array.from(registry.byName.values())
  .map(e => e.def.template ?? "")  // wrappers carry no <style>; this is the easy part
  .join("\n");
// For component <style> blocks, registry.combinedCss already collects them — use it.
const consumedCss = stylesCss + "\n" + (registry.combinedCss ?? "");
findings.push(...checkTokens({ projectDir, tokens: config["design-tokens"], consumedCss }));
```

(Confirm the actual field name on the registry — adjust if it's different.)

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git add packages/core/src/lint/checks/tokens.ts packages/core/src/lint/checks/tokens.test.ts packages/core/src/lint/index.ts
git commit -m "feat(lint): tender/token-unused (info) for declared-but-unreferenced tokens"
```

---

## Phase 3 — CLI

### Task 8: Add `yaml` package to the CLI

**Files:**
- Modify: `packages/cli/package.json`

**Step 1: Add dependency**

```bash
cd packages/cli && pnpm add yaml@^2.6.0
```

`yaml` (the npm package, distinct from `js-yaml`) supports document-mode AST round-trip with comment preservation, which `js-yaml` does not. We need this for `tender tokens set` to write back without destroying comments.

**Step 2: Smoke test**

Add a quick sanity test in `packages/cli/src/commands/tokens.test.ts` (file doesn't exist yet — create it):

```ts
import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";

describe("yaml round-trip sanity", () => {
  it("preserves comments when modifying a value", () => {
    const src = `
# top comment
page-templates:
  default: { size: A4, margin: 0 }
design-tokens:
  color:
    ink: '#000'  # current ink
`;
    const doc = parseDocument(src);
    doc.setIn(["design-tokens", "color", "ink"], "#1a1a1a");
    const out = doc.toString();
    expect(out).toContain("# top comment");
    expect(out).toContain("# current ink");
    expect(out).toContain("ink: \"#1a1a1a\"");
  });
});
```

**Step 3: Run, verify pass**

```
pnpm --filter @tender/cli test
```

**Step 4: Commit**

```bash
git add packages/cli/package.json packages/cli/src/commands/tokens.test.ts pnpm-lock.yaml
git commit -m "chore(cli): add yaml@2 for project.yaml AST round-trip"
```

---

### Task 9: `tender tokens list` (read-only)

**Files:**
- Create: `packages/cli/src/commands/tokens.ts`
- Modify: `packages/cli/src/commands/tokens.test.ts`
- Modify: `packages/cli/src/cli.ts`

**Step 1: Tests**

```ts
import { listTokens, formatTokensList } from "./tokens.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../core/test/fixtures");

describe("tokens list", () => {
  it("returns the resolved token set as JSON-shaped data", async () => {
    const tokens = await listTokens(join(fixturesDir, "design-tokens"));
    expect(tokens.color?.ink).toBe("#1a1a1a");
    expect(tokens.size?.body).toBe("11pt");
  });

  it("returns an empty object when design-tokens is absent", async () => {
    const tokens = await listTokens(join(fixturesDir, "hello"));
    expect(tokens).toEqual({});
  });

  it("formatTokensList renders categories and tokens", () => {
    const text = formatTokensList({
      color: { ink: "#1a1a1a", accent: "#FFE600" },
      size: { body: "11pt" }
    });
    expect(text).toContain("color");
    expect(text).toContain("ink");
    expect(text).toContain("#1a1a1a");
    expect(text).toContain("accent");
    expect(text).toContain("size");
    expect(text).toContain("body");
    expect(text).toMatch(/2 categories, 3 tokens/);
  });

  it("formatTokensList handles empty tokens", () => {
    expect(formatTokensList({})).toContain("No design tokens defined");
  });
});
```

**Step 2: Implement**

`packages/cli/src/commands/tokens.ts`:

```ts
import { loadProjectConfig } from "@tender/core";
import { cyan, dim } from "../ui/style.js";

type Tokens = Record<string, Record<string, string | number>>;

export async function listTokens(projectDir: string): Promise<Tokens> {
  const config = await loadProjectConfig(projectDir);
  return (config["design-tokens"] ?? {}) as Tokens;
}

/** Truecolor swatch for a hex color. Dim block char as fallback when not a hex. */
function swatch(value: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!m) return "";
  const hex = m[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // OSC truecolor — degrades to nothing visible on non-truecolor terms;
  // we accept that. The hex value itself is also printed.
  return `\x1b[38;2;${r};${g};${b}m■\x1b[39m`;
}

export function formatTokensList(tokens: Tokens): string {
  const categories = Object.entries(tokens);
  if (categories.length === 0) return "No design tokens defined.";
  const lines: string[] = [];
  let totalTokens = 0;
  for (const [category, group] of categories) {
    lines.push(cyan(category));
    const entries = Object.entries(group);
    const longest = Math.max(...entries.map(([n]) => n.length));
    for (const [name, value] of entries) {
      totalTokens++;
      const padded = name.padEnd(longest);
      const v = String(value);
      const sw = category === "color" ? `  ${swatch(v)}` : "";
      lines.push(`  ${padded}  ${v}${sw}`);
    }
    lines.push("");
  }
  lines.push(dim(`${categories.length} categories, ${totalTokens} tokens.`));
  return lines.join("\n");
}
```

(Note: `loadProjectConfig` may or may not be in the package's public exports — confirm in `packages/core/src/index.ts` and add the export if missing.)

**Step 3: Wire into `cli.ts`**

```ts
import { listTokens, formatTokensList } from "./commands/tokens.js";

program
  .command("tokens")
  .description("List, set, and edit design tokens")
  .addHelpText("after", "\nRun `tender tokens list` to see your tokens, `tender tokens set <token> <value>` to write one, or `tender tokens edit` for an interactive picker.\n");

program
  .command("tokens:list [dir]", { hidden: true })  // alias for `tokens list`
  // …actually use commander's command-of-command pattern:

const tokensCmd = program.command("tokens").description("Inspect and edit design tokens");
tokensCmd
  .command("list [dir]")
  .description("List the project's design tokens")
  .option("--json", "emit tokens as JSON")
  .addHelpText("after", "\nExamples:\n  $ tender tokens list\n  $ tender tokens list --json | jq '.color'\n")
  .action(async (dir: string | undefined, opts: { json?: boolean }) => {
    const projectDir = resolve(dir ?? ".");
    const tokens = await listTokens(projectDir);
    if (opts.json) {
      console.log(JSON.stringify(tokens, null, 2));
    } else {
      console.log(formatTokensList(tokens));
    }
  });
```

(Use commander's nested-subcommand idiom — verify the exact API surface during implementation; commander 12 supports `.command()` chaining.)

**Step 4: Run tests, verify pass**

```
pnpm --filter @tender/cli test
```

Manual smoke test:
```
pnpm --filter @tender/cli build
node packages/cli/dist/cli.js tokens list packages/core/test/fixtures/design-tokens
```

**Step 5: Commit**

```bash
git add packages/cli/src/commands/tokens.ts packages/cli/src/commands/tokens.test.ts packages/cli/src/cli.ts
git commit -m "feat(cli): tender tokens list (with --json)"
```

---

### Task 10: `tender tokens set <token> <value>`

**Files:**
- Modify: `packages/cli/src/commands/tokens.ts`
- Modify: `packages/cli/src/commands/tokens.test.ts`
- Modify: `packages/cli/src/cli.ts`

**Step 1: Tests**

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setToken } from "./tokens.js";

describe("tokens set", () => {
  it("updates an existing token, preserving comments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `# top comment
page-templates:
  default: { size: A4, margin: 0 }

design-tokens:
  color:
    ink: '#000'  # original
`);
      const result = await setToken(dir, "color.ink", "#1a1a1a");
      expect(result.previous).toBe("#000");
      expect(result.next).toBe("#1a1a1a");
      expect(result.created).toBe(false);
      const after = await readFile(join(dir, "project.yaml"), "utf8");
      expect(after).toContain("# top comment");
      expect(after).toContain("# original");
      expect(after).toMatch(/ink:\s+["']?#1a1a1a/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates a new token in an existing category", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `page-templates:
  default: { size: A4, margin: 0 }

design-tokens:
  color:
    ink: '#000'
`);
      const result = await setToken(dir, "color.brand", "#abc");
      expect(result.created).toBe(true);
      expect(result.next).toBe("#abc");
      const after = await readFile(join(dir, "project.yaml"), "utf8");
      expect(after).toMatch(/brand:\s+["']?#abc/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the design-tokens block and category if neither exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `page-templates:
  default: { size: A4, margin: 0 }
`);
      const result = await setToken(dir, "color.ink", "#000");
      expect(result.created).toBe(true);
      const after = await readFile(join(dir, "project.yaml"), "utf8");
      expect(after).toContain("design-tokens:");
      expect(after).toContain("color:");
      expect(after).toMatch(/ink:\s+["']?#000/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects token paths that aren't `category.name`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-tokens-set-"));
    try {
      await writeFile(join(dir, "project.yaml"), `page-templates:
  default: { size: A4, margin: 0 }
`);
      await expect(setToken(dir, "color", "#000")).rejects.toThrow(/category.name/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

**Step 2: Implement**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

export interface SetTokenResult {
  previous: string | undefined;
  next: string;
  created: boolean;
}

export async function setToken(
  projectDir: string,
  tokenPath: string,
  value: string
): Promise<SetTokenResult> {
  const m = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(tokenPath);
  if (!m) throw new Error(`Token path must be \`category.name\` (got: ${tokenPath})`);
  const [, category, name] = m;
  const path = join(projectDir, "project.yaml");
  const src = await readFile(path, "utf8");
  const doc = parseDocument(src);

  const previous = doc.getIn(["design-tokens", category, name]);
  doc.setIn(["design-tokens", category, name], value);

  await writeFile(path, doc.toString());
  return {
    previous: previous === undefined || previous === null ? undefined : String(previous),
    next: value,
    created: previous === undefined || previous === null
  };
}
```

**Step 3: Wire into `cli.ts`**

```ts
tokensCmd
  .command("set <token> <value> [dir]")
  .description("Set a design token value (writes project.yaml in place)")
  .addHelpText("after", "\nExamples:\n  $ tender tokens set color.accent '#c33'\n  $ tender tokens set size.body 11pt\n")
  .action(async (token: string, value: string, dir: string | undefined) => {
    const projectDir = resolve(dir ?? ".");
    const result = await setToken(projectDir, token, value);
    const before = result.created ? dim("(new)") : (result.previous ?? "");
    console.log(`  ${cyan(token)}: ${before} → ${result.next}`);
    console.log(dim(`  Wrote ${join(projectDir, "project.yaml")}.`));
  });
```

**Step 4: Run tests, manual smoke test, verify**

**Step 5: Commit**

```bash
git add packages/cli/src/commands/tokens.ts packages/cli/src/commands/tokens.test.ts packages/cli/src/cli.ts
git commit -m "feat(cli): tender tokens set (creates or updates; preserves comments)"
```

---

### Task 11: `tender tokens edit` (minimal interactive picker)

**Files:**
- Modify: `packages/cli/src/commands/tokens.ts`
- Modify: `packages/cli/src/cli.ts`
- Manual smoke test only (no automated TTY tests).

**Step 1: Implement**

In `tokens.ts`, add an `editTokens(projectDir)` async function that:

1. Calls `listTokens` for the current state.
2. Builds a flat array of `{path: "color.ink", value: "#1a1a1a"}` entries.
3. Enters raw mode on stdin via `readline.emitKeypressEvents` and `process.stdin.setRawMode(true)`.
4. Tracks: `cursor` (which token is highlighted), `editing` (boolean), `buffer` (in-progress edit string), `dirty` (Map of path → new value).
5. Re-renders on every keypress: a list with the cursor highlighted, the active edit buffer if `editing`, and a footer with key bindings.
6. Keys: ↑/↓ moves cursor, `Enter` enters edit mode (or commits when editing), `Esc` cancels edit, `s` saves all dirty edits via `setToken`, `q` quits (prompts y/n if dirty).
7. Restores raw mode and cursor on exit.

This is ~150 lines. Implementer: keep the rendering simple — clear the screen with `\x1b[2J\x1b[H` on each render rather than tracking diffs.

**Skeleton:**

```ts
export async function editTokens(projectDir: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("tender tokens edit requires an interactive terminal.");
    process.exit(1);
  }
  // …raw mode loop, save via setToken on `s`
}
```

**Step 2: Wire into `cli.ts`**

```ts
tokensCmd
  .command("edit [dir]")
  .description("Interactive picker for design tokens (TTY required)")
  .action(async (dir: string | undefined) => {
    await editTokens(resolve(dir ?? "."));
  });
```

**Step 3: Manual smoke test**

```
pnpm --filter @tender/cli build
node packages/cli/dist/cli.js tokens edit packages/core/test/fixtures/design-tokens
```

Verify: navigation works, edit/commit/cancel works, save writes the file, quit-with-dirty prompts.

**Step 4: Commit**

```bash
git add packages/cli/src/commands/tokens.ts packages/cli/src/cli.ts
git commit -m "feat(cli): tender tokens edit (minimal interactive picker)"
```

---

## Phase 4 — Migration + docs

### Task 12: Migrate `coastal-planet-tags` fixture to `design-tokens:`

**Files:**
- Modify: `packages/core/test/fixtures/coastal-planet-tags/project.yaml`
- Modify: `packages/core/test/fixtures/coastal-planet-tags/styles.css`

**Step 1: Move tokens from styles.css to project.yaml**

Take every `--foo: bar;` line from the `:root { ... }` block in `styles.css` and convert it to `design-tokens:` in `project.yaml`. Keep names parallel: `--color-ink: #1a1a1a` → `color: { ink: "#1a1a1a" }`.

The `:root` block in styles.css gets deleted entirely.

**Step 2: Run the existing coastal tests, verify still pass**

```
pnpm --filter @tender/core test -- coastal
```

The PDF/HTML output should be byte-identical or near-identical (a `:root` block now generated rather than hand-written, but the same custom properties resolve).

**Step 3: Update the lint expectations**

The fixture's lint test (in `lint.test.ts` in cli) asserts "no errors or deprecation, only unused-component warnings." After migration there might be `tender/token-unused` info findings — those are info-level so default exit code stays 0, but adjust the test if it asserts on `findings.length`.

**Step 4: Commit**

```bash
git add packages/core/test/fixtures/coastal-planet-tags/
git commit -m "chore(fixtures): migrate coastal-planet-tags to design-tokens"
```

---

### Task 13: User-guide section

**Files:**
- Modify: `docs/user-guide.md`

**Step 1: Add a "Design tokens" section**

Cover:

1. What tokens are and why use them. (One paragraph.)
2. The categorised YAML shape — short example.
3. The naming → CSS variable mapping (`color.accent` → `--color-accent`).
4. **The user-CSS-wins rule, explicitly.** Worked example: setting `--color-brand` in styles.css overrides `design-tokens.color.brand`.
5. **The CSS-side workaround for indirection.** Worked example: deriving `--accent` from `--color-brand` via `:root { --accent: var(--color-brand); }` in styles.css.
6. The `tender tokens` CLI: list, set, edit. One example each.
7. Lint codes the user might see: `tender/token-name-invalid`, `tender/token-value-shape`, `tender/token-unused`.

Place the new section near "Project structure" / "Authoring conventions" — wherever the user-guide currently introduces `project.yaml` keys.

**Step 2: Verify docs build cleanly** (if there's a docs check; otherwise skip)

**Step 3: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs(user-guide): design tokens — schema, CLI, user-CSS escape hatch"
```

---

### Task 13b: README updates

**Files:**
- Modify: `README.md`

**Step 1: Update the "Project structure" listing**

The current snippet describes `project.yaml` as "page templates, typography, fonts, inline shortcuts". Add design tokens to that comment and reflect the new shape in the listing if it shows nested keys.

```
my-doc/
  project.yaml      # page templates, typography, fonts, inline shortcuts, design tokens
  styles.css        # presentation
  …
```

**Step 2: Update the "Commands" list**

Add a `tender tokens` line modeled after the existing entries. Keep it concise (one line, parenthetical flag list):

```
- `tender tokens list|set|edit` — inspect and edit design tokens (`--json` on `list`)
```

**Step 3: Decide whether to add a top-level "Design tokens" subsection in the README**

Match the README's existing depth. Today it has subsections for Install, Quick start, Onboarding from existing prose, Preview UI, Project structure, Commands. A 4–6 line "Design tokens" subsection between Preview UI and Project structure is appropriate — names the feature, shows one tiny YAML snippet, links to `docs/user-guide.md#design-tokens` for the rest.

```markdown
## Design tokens

Define your project's design vocabulary in `project.yaml` under `design-tokens:`:

\`\`\`yaml
design-tokens:
  color:
    ink: '#1a1a1a'
    accent: '#FFE600'
  size:
    body: 12pt
\`\`\`

These compile to CSS custom properties (`--color-ink`, `--size-body`, …) your components consume via `var()`. See the [design tokens guide](docs/user-guide.md#design-tokens) for the full schema and the `tender tokens` CLI.
```

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): mention design-tokens schema and tender tokens CLI"
```

**Note (out of scope of this plan, but worth flagging at completion):** the `tender-author` skill (`~/.claude/skills/tender-author/SKILL.md` and friends) currently teaches authors to put design tokens in `styles.css`'s `:root`. Once this plan ships, the skill should be updated to teach the new YAML-first workflow with the user-CSS escape hatch. That's a separate skill-update pass, not a code change in this repo — file a TODO or quick GH issue at the end of Task 15 so it doesn't get lost.

---

### Task 14: Open the "full token picker" GitHub issue

**Step 1: Open the issue**

```bash
gh issue create --title "Full design-token picker (color, length, font preview)" --body "$(cat <<'EOF'
v1 of `tender tokens edit` is intentionally minimal: arrow-key navigation, plain-text value editing, save/quit. Per the design doc (`docs/plans/2026-05-10-design-tokens-design.md`), the full picker is tracked separately.

## Scope

- **Color tokens**: 24-bit color picker with HSL sliders, hex input, contrast feedback for ink/page pairs.
- **Length tokens**: +/- steppers, unit cycling (`pt`/`mm`/`em`), live preview of resulting size if practical.
- **Font tokens**: scrollable font preview using available system fonts (or just the fonts declared in `project.yaml`'s `fonts:` block).
- **Token-set picker**: load/save named token sets (a "themes" feature on top of the same YAML).

## Non-goals

- Live PDF re-render on every keystroke. Save-and-rebuild is the workflow.
- A graphical UI; this stays terminal-native.

## Constraints

- No new heavyweight deps. The minimal v1 is ~150 lines of `readline`; a fancy picker might need a TUI lib like `ink` (React) or `blessed`. Decide as part of the implementation pass — both have maintenance costs worth weighing.
- Plays nicely under `NO_COLOR` / non-TTY (degrades to "edit project.yaml directly").

## Definition of done

- Each token category has its native picker.
- The picker supports adding new tokens (not just editing existing).
- A short usage section in the user-guide.
EOF
)"
```

**Step 2: Note the issue number in the design doc**

Append to `docs/plans/2026-05-10-design-tokens-design.md`'s "Out of scope → Token preview UI" subsection:

> The full token picker is tracked in #N (where N is the issue number gh prints).

**Step 3: Commit the design-doc update**

```bash
git add docs/plans/2026-05-10-design-tokens-design.md
git commit -m "docs(plans): link full-token-picker issue from tokens design doc"
```

---

## Final verification

### Task 15: Full test suite + manual smoke tests

**Step 1: Run all tests**

```bash
cd /home/jh/repos/tender
pnpm typecheck
pnpm test
```

All packages green.

**Step 2: Build the coastal fixture**

```bash
pnpm --filter @tender/cli build
node packages/cli/dist/cli.js build packages/core/test/fixtures/coastal-planet-tags --out /tmp/coastal-out
```

Verify the PDF still renders correctly (open it, eyeball it, compare to a pre-migration build if possible).

**Step 3: Smoke-test each `tender tokens` subcommand**

```bash
node packages/cli/dist/cli.js tokens list packages/core/test/fixtures/coastal-planet-tags
node packages/cli/dist/cli.js tokens list --json packages/core/test/fixtures/coastal-planet-tags | jq .
node packages/cli/dist/cli.js tokens set color.accent '#c33' /tmp/some-fixture-copy
node packages/cli/dist/cli.js tokens edit /tmp/some-fixture-copy
```

**Step 4: Final commit if any tweaks needed**

If anything had to be patched during smoke testing, commit each fix with a clear message.

**Step 5: Push to trunk**

```bash
git push
```

---

## Risk register

- **Token-name collisions across categories.** The schema allows `color.ink` and `font.ink` simultaneously (they compile to different CSS variables — `--color-ink` and `--font-ink`). This is by design but worth noting in the user-guide so authors don't get surprised.

- **`yaml` package size.** Adds ~80KB to the CLI bundle. Acceptable given it's a dev tool, but flag if bundle size becomes a concern.

- **`tender tokens edit` raw-mode portability.** Windows terminals (especially old `cmd.exe`) handle raw mode unevenly. Document that the picker requires a modern terminal; degrade gracefully (print "use `tender tokens set` instead") when raw mode unavailable.

- **Migration risk on coastal fixture.** Task 12 changes the fixture's `styles.css`. Other tests that snapshot `result.stylesCss` may need updating. The build-output PDF should be byte-similar but Paged.js render is stateful — rerun all coastal tests, not just the lint test.

- **`tender/token-unused` false positives.** If a token is referenced via `var(--color-ink)` but the CSS that does so is dynamically generated (e.g. JS in preview-ui), the lint will flag it as unused. v1 only walks static CSS — accept this and document.
