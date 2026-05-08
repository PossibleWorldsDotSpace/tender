# Tender Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Node/TypeScript CLI that turns a project directory (`project.yaml` + `styles.css` + `content.md`) into a print-ready PDF and self-contained HTML, using Paged.js + Puppeteer as the layout engine.

**Architecture:** Three packages in a pnpm workspace — `@tender/core` (parse/transform, no browser), `@tender/render` (Paged.js + Puppeteer), `@tender/cli` (user entry). Vertical slice first: get plain prose to PDF end-to-end, then layer on templates, page templates, headers/footers, hyphenation, preview server. Reproduce `example.html` as the final integration test.

**Tech Stack:** Node 20+, TypeScript, pnpm workspaces, Vitest, `unified`/`remark`/`remark-directive`, Handlebars, `js-yaml`, Zod (config validation), Puppeteer, Paged.js, Express, Chokidar, Commander.

**Reference:** see `docs/plans/2026-05-08-tender-design.md` for the full design rationale.

---

## How to use this plan

- Each task lists exact files to create/modify, exact commands to run, and exact expected output.
- Each task ends with a commit. Don't batch.
- Phases end with a runnable artifact you can demo. Don't move to the next phase if the current artifact doesn't work.
- TDD throughout: write the failing test first, see it fail, implement minimally, see it pass.
- All paths are relative to the repo root unless prefixed with a package name like `packages/core/`.
- Hyphens in task IDs are stable; you can refer to "Task 3.2" in PR descriptions or notes.

---

## Phase 0 — Repo and tooling setup

Set up the monorepo, TypeScript, lint, test runner, and CI scaffolding before any product code.

### Task 0.1: Initialize pnpm workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.nvmrc`

**Step 1: Create root `package.json`**

```json
{
  "name": "tender",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  },
  "engines": { "node": ">=20.0.0" },
  "packageManager": "pnpm@9.0.0"
}
```

**Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

**Step 3: Create `.gitignore`**

```
node_modules/
dist/
out/
*.log
.DS_Store
.vitest-cache/
*.tsbuildinfo
```

**Step 4: Create `.nvmrc`**

```
20
```

**Step 5: Verify pnpm is installed**

Run: `pnpm --version`
Expected: a version string (≥9). If not installed: `npm install -g pnpm@9`.

**Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore .nvmrc
git commit -m "chore: initialize pnpm workspace"
```

### Task 0.2: Add TypeScript base config

**Files:**
- Create: `tsconfig.base.json`

**Step 1: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore: add base tsconfig"
```

### Task 0.3: Create `@tender/core` package skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/vitest.config.ts`

**Step 1: `packages/core/package.json`**

```json
{
  "name": "@tender/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**Step 2: `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*"]
}
```

**Step 3: `packages/core/src/index.ts`**

```typescript
export const VERSION = "0.0.0";
```

**Step 4: `packages/core/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] }
});
```

**Step 5: Install and verify**

```bash
pnpm install
pnpm --filter @tender/core typecheck
pnpm --filter @tender/core build
```
Expected: clean output, `packages/core/dist/index.js` exists.

**Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): scaffold @tender/core package"
```

### Task 0.4: Create `@tender/render` and `@tender/cli` skeletons

Repeat Task 0.3 verbatim for each of these two packages, substituting the name. Each gets its own `package.json`, `tsconfig.json`, `src/index.ts` (`export const VERSION = "0.0.0";`), and `vitest.config.ts`. The `@tender/cli` package additionally needs `"bin": { "tender": "./dist/cli.js" }` in its `package.json` and an entry file `src/cli.ts` that just contains `#!/usr/bin/env node\nconsole.log("tender");`.

**Step 1–4:** Create the files for each package as in Task 0.3.

**Step 5: Verify the workspace builds**

```bash
pnpm install
pnpm -r typecheck
pnpm -r build
```
Expected: clean output across all three packages.

**Step 6: Commit**

```bash
git add packages/render packages/cli pnpm-lock.yaml
git commit -m "feat: scaffold @tender/render and @tender/cli packages"
```

### Task 0.5: Add CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Write the workflow**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r build
      - run: pnpm -r test
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add typecheck/build/test workflow"
```

---

## Phase 1 — Vertical slice: plain Markdown to PDF + HTML

End of phase: `tender build <dir>` on a project containing `project.yaml`, `styles.css`, `content.md` produces `out/document.pdf` and `out/document.html`. No components yet — just CommonMark.

### Task 1.1: Define the project config schema

**Files:**
- Create: `packages/core/src/config/schema.ts`
- Create: `packages/core/src/config/schema.test.ts`

Use Zod for validation. v1 schema covers only what Phase 1 needs — everything else gets added when its phase arrives.

**Step 1: Write the failing test**

```typescript
// packages/core/src/config/schema.test.ts
import { describe, it, expect } from "vitest";
import { ProjectConfig } from "./schema.ts";

describe("ProjectConfig", () => {
  it("parses a minimal valid config", () => {
    const config = ProjectConfig.parse({
      "page-templates": {
        default: {
          size: "A5",
          margin: { top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm" }
        }
      }
    });
    expect(config["page-templates"].default.size).toBe("A5");
  });

  it("rejects a config with no default page template", () => {
    expect(() =>
      ProjectConfig.parse({ "page-templates": { other: { size: "A5", margin: {} } } })
    ).toThrow(/default/);
  });
});
```

**Step 2: Add Zod dependency**

```bash
pnpm --filter @tender/core add zod
```

**Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tender/core test`
Expected: FAIL with "Cannot find module './schema.ts'".

**Step 4: Implement the schema**

```typescript
// packages/core/src/config/schema.ts
import { z } from "zod";

const Length = z.string().regex(/^-?\d+(\.\d+)?(mm|cm|in|pt|px)$/);
const PageSize = z.union([
  z.enum(["A4", "A5", "A6", "Letter", "Legal"]),
  z.tuple([Length, Length])
]);
const Margin = z.object({
  top: Length.optional(),
  bottom: Length.optional(),
  inner: Length.optional(),
  outer: Length.optional(),
  left: Length.optional(),
  right: Length.optional()
}).or(z.literal(0));

export const PageTemplate = z.object({
  size: PageSize,
  margin: Margin,
  bleed: Length.optional()
});

export const ProjectConfig = z.object({
  "page-templates": z.record(z.string(), PageTemplate)
    .refine(t => "default" in t, { message: "page-templates.default is required" })
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
```

**Step 5: Run the test**

Run: `pnpm --filter @tender/core test`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/core/src/config packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add ProjectConfig schema (page-templates only)"
```

### Task 1.2: Load `project.yaml` from disk

**Files:**
- Create: `packages/core/src/config/load.ts`
- Create: `packages/core/src/config/load.test.ts`
- Create: `packages/core/test/fixtures/minimal/project.yaml`

**Step 1: Create the fixture**

```yaml
# packages/core/test/fixtures/minimal/project.yaml
page-templates:
  default:
    size: A5
    margin: { top: 18mm, bottom: 20mm, inner: 18mm, outer: 14mm }
```

**Step 2: Write the failing test**

```typescript
// packages/core/src/config/load.test.ts
import { describe, it, expect } from "vitest";
import { loadProjectConfig } from "./load.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../test/fixtures");

describe("loadProjectConfig", () => {
  it("loads and validates a minimal project.yaml", async () => {
    const config = await loadProjectConfig(join(fixturesDir, "minimal"));
    expect(config["page-templates"].default.size).toBe("A5");
  });

  it("throws a helpful error when project.yaml is missing", async () => {
    await expect(loadProjectConfig(join(fixturesDir, "does-not-exist")))
      .rejects.toThrow(/project\.yaml/);
  });
});
```

**Step 3: Add yaml dependency**

```bash
pnpm --filter @tender/core add js-yaml
pnpm --filter @tender/core add -D @types/js-yaml
```

**Step 4: Run the test, see it fail**

Run: `pnpm --filter @tender/core test`
Expected: FAIL with "Cannot find module './load.ts'".

**Step 5: Implement**

```typescript
// packages/core/src/config/load.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { ProjectConfig } from "./schema.ts";

export async function loadProjectConfig(projectDir: string): Promise<ProjectConfig> {
  const path = join(projectDir, "project.yaml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`project.yaml not found at ${path}`);
    }
    throw err;
  }
  const data = parseYaml(raw);
  return ProjectConfig.parse(data);
}
```

**Step 6: Run the test**

Run: `pnpm --filter @tender/core test`
Expected: PASS.

**Step 7: Commit**

```bash
git add packages/core packages/core/test pnpm-lock.yaml
git commit -m "feat(core): load and validate project.yaml from disk"
```

### Task 1.3: Parse `content.md` to HTML (CommonMark only)

**Files:**
- Create: `packages/core/src/parse/markdown.ts`
- Create: `packages/core/src/parse/markdown.test.ts`

**Step 1: Failing test**

```typescript
// packages/core/src/parse/markdown.test.ts
import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./markdown.ts";

describe("parseMarkdown", () => {
  it("renders a heading and a paragraph", async () => {
    const html = await parseMarkdown("# Hello\n\nA paragraph.\n");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>A paragraph.</p>");
  });
});
```

**Step 2: Add deps**

```bash
pnpm --filter @tender/core add unified remark-parse remark-rehype rehype-stringify
```

**Step 3: Run, see it fail.**

**Step 4: Implement**

```typescript
// packages/core/src/parse/markdown.ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

export async function parseMarkdown(source: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(source);
  return String(file);
}
```

**Step 5: Run, see it pass.**

**Step 6: Commit**

```bash
git add packages/core/src/parse packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): parse CommonMark to HTML"
```

### Task 1.4: Compose the full HTML document

**Files:**
- Create: `packages/core/src/compose/document.ts`
- Create: `packages/core/src/compose/document.test.ts`

The composer wraps body HTML in a minimal HTML shell with placeholders for `_project.css` and `styles.css`. The render layer fills these in.

**Step 1: Failing test**

```typescript
// packages/core/src/compose/document.test.ts
import { describe, it, expect } from "vitest";
import { composeDocument } from "./document.ts";

describe("composeDocument", () => {
  it("wraps body HTML in an HTML5 document with both stylesheet links", () => {
    const html = composeDocument({
      bodyHtml: "<h1>Hi</h1>",
      lang: "en-GB",
      title: "Test"
    });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('href="_project.css"');
    expect(html).toContain('href="styles.css"');
    expect(html).toContain("<h1>Hi</h1>");
  });
});
```

**Step 2: Run, see it fail.**

**Step 3: Implement**

```typescript
// packages/core/src/compose/document.ts
export interface ComposeInput {
  bodyHtml: string;
  lang: string;
  title: string;
}

export function composeDocument(input: ComposeInput): string {
  return `<!DOCTYPE html>
<html lang="${escapeAttr(input.lang)}">
<head>
<meta charset="UTF-8">
<title>${escapeText(input.title)}</title>
<link rel="stylesheet" href="_project.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${input.bodyHtml}
</body>
</html>`;
}

function escapeAttr(s: string) { return s.replace(/"/g, "&quot;"); }
function escapeText(s: string) { return s.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!)); }
```

**Step 4: Run, see it pass.**

**Step 5: Commit**

```bash
git add packages/core/src/compose
git commit -m "feat(core): compose full HTML document"
```

### Task 1.5: Generate `_project.css` from config

**Files:**
- Create: `packages/core/src/compose/project-css.ts`
- Create: `packages/core/src/compose/project-css.test.ts`

For Phase 1, this only emits a single `@page default` rule from the page-template config. Headers/footers, hyphenation, and template-specific page rules come in later phases.

**Step 1: Failing test**

```typescript
// packages/core/src/compose/project-css.test.ts
import { describe, it, expect } from "vitest";
import { generateProjectCss } from "./project-css.ts";

describe("generateProjectCss", () => {
  it("emits @page default with size and margin", () => {
    const css = generateProjectCss({
      "page-templates": {
        default: {
          size: "A5",
          margin: { top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm" }
        }
      }
    });
    expect(css).toContain("@page default");
    expect(css).toContain("size: A5");
    expect(css).toMatch(/margin:\s*18mm\s+14mm\s+20mm\s+18mm/); // top right(=outer) bottom left(=inner)
    expect(css).toContain(".page { page: default; }");
  });
});
```

**Step 2: Run, see it fail.**

**Step 3: Implement**

```typescript
// packages/core/src/compose/project-css.ts
import type { ProjectConfig } from "../config/schema.ts";

export function generateProjectCss(config: ProjectConfig): string {
  const parts: string[] = [];
  for (const [name, tpl] of Object.entries(config["page-templates"])) {
    parts.push(`@page ${name} {`);
    parts.push(`  size: ${formatSize(tpl.size)};`);
    parts.push(`  margin: ${formatMargin(tpl.margin)};`);
    parts.push(`}`);
  }
  parts.push(`.page { page: default; }`);
  for (const name of Object.keys(config["page-templates"])) {
    if (name !== "default") {
      parts.push(`.page[data-page-template="${name}"] { page: ${name}; }`);
    }
  }
  return parts.join("\n") + "\n";
}

function formatSize(size: string | [string, string]): string {
  return Array.isArray(size) ? `${size[0]} ${size[1]}` : size;
}

function formatMargin(margin: unknown): string {
  if (margin === 0) return "0";
  const m = margin as Record<string, string | undefined>;
  const top = m.top ?? "0";
  const bottom = m.bottom ?? "0";
  const inner = m.inner ?? m.left ?? "0";
  const outer = m.outer ?? m.right ?? "0";
  return `${top} ${outer} ${bottom} ${inner}`;
}
```

**Step 4: Run, see it pass.**

**Step 5: Commit**

```bash
git add packages/core/src/compose/project-css.ts packages/core/src/compose/project-css.test.ts
git commit -m "feat(core): generate _project.css from page-templates config"
```

### Task 1.6: Wire core's top-level `buildProject` function

**Files:**
- Create: `packages/core/src/build.ts`
- Create: `packages/core/src/build.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/fixtures/hello/project.yaml`
- Create: `packages/core/test/fixtures/hello/styles.css`
- Create: `packages/core/test/fixtures/hello/content.md`

**Step 1: Create the fixture**

`packages/core/test/fixtures/hello/project.yaml`:
```yaml
page-templates:
  default:
    size: A5
    margin: { top: 18mm, bottom: 20mm, inner: 18mm, outer: 14mm }
```

`packages/core/test/fixtures/hello/styles.css`:
```css
body { font-family: serif; }
```

`packages/core/test/fixtures/hello/content.md`:
```markdown
# Hello, Tender

A first paragraph.
```

**Step 2: Failing test**

```typescript
// packages/core/src/build.test.ts
import { describe, it, expect } from "vitest";
import { buildProject } from "./build.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../test/fixtures");

describe("buildProject", () => {
  it("returns html, projectCss, stylesCss, and config", async () => {
    const result = await buildProject(join(fixturesDir, "hello"));
    expect(result.html).toContain("<h1>Hello, Tender</h1>");
    expect(result.html).toContain('href="_project.css"');
    expect(result.projectCss).toContain("@page default");
    expect(result.stylesCss).toContain("font-family: serif");
    expect(result.config["page-templates"].default.size).toBe("A5");
  });
});
```

**Step 3: Run, see it fail.**

**Step 4: Implement**

```typescript
// packages/core/src/build.ts
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { loadProjectConfig } from "./config/load.ts";
import { parseMarkdown } from "./parse/markdown.ts";
import { composeDocument } from "./compose/document.ts";
import { generateProjectCss } from "./compose/project-css.ts";
import type { ProjectConfig } from "./config/schema.ts";

export interface BuildResult {
  html: string;
  projectCss: string;
  stylesCss: string;
  config: ProjectConfig;
  projectDir: string;
}

export async function buildProject(projectDir: string): Promise<BuildResult> {
  const config = await loadProjectConfig(projectDir);
  const md = await readFile(join(projectDir, "content.md"), "utf8");
  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
  const bodyHtml = `<div class="page">${await parseMarkdown(md)}</div>`;
  const html = composeDocument({ bodyHtml, lang: "en", title: basename(projectDir) });
  const projectCss = generateProjectCss(config);
  return { html, projectCss, stylesCss, config, projectDir };
}
```

**Step 5: Update `packages/core/src/index.ts`**

```typescript
export { buildProject } from "./build.ts";
export type { BuildResult } from "./build.ts";
export { loadProjectConfig } from "./config/load.ts";
export { ProjectConfig } from "./config/schema.ts";
```

**Step 6: Run, see it pass.**

**Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): top-level buildProject function"
```

### Task 1.7: Render HTML to PDF + standalone HTML

**Files:**
- Create: `packages/render/src/render.ts`
- Create: `packages/render/src/render.test.ts`
- Modify: `packages/render/src/index.ts`
- Modify: `packages/render/package.json`

The render package owns the only browser dep. Paged.js runs as a script in the page; Puppeteer waits for `pagedjs-after-render` event then exports.

**Step 1: Add deps**

```bash
pnpm --filter @tender/render add puppeteer pagedjs
pnpm --filter @tender/render add -D @types/node
```

**Step 2: Failing test**

```typescript
// packages/render/src/render.test.ts
import { describe, it, expect } from "vitest";
import { renderHtml, renderPdf } from "./render.ts";

const FIXTURE = {
  html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>T</title>
<link rel="stylesheet" href="_project.css">
<link rel="stylesheet" href="styles.css">
</head><body><div class="page"><h1>Hello</h1><p>A paragraph.</p></div></body></html>`,
  projectCss: `@page default { size: A5; margin: 18mm 14mm 20mm 18mm; }
.page { page: default; }`,
  stylesCss: `body { font-family: serif; }`,
  projectDir: "/tmp" // unused by these tests
};

describe("renderHtml", () => {
  it("returns a self-contained HTML string with paginated content", async () => {
    const html = await renderHtml(FIXTURE);
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain(".pagedjs_page"); // Paged.js wraps content
  }, 60_000);
});

describe("renderPdf", () => {
  it("returns a non-empty PDF buffer", async () => {
    const buf = await renderPdf(FIXTURE);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);
});
```

**Step 3: Run, see it fail.**

**Step 4: Implement**

```typescript
// packages/render/src/render.ts
import puppeteer, { type Browser } from "puppeteer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pagedJsPath = require.resolve("pagedjs/dist/paged.polyfill.js");

export interface RenderInput {
  html: string;
  projectCss: string;
  stylesCss: string;
  projectDir: string;
}

async function setupPage(input: RenderInput, browser: Browser) {
  const page = await browser.newPage();
  // Intercept the two stylesheet requests so we don't need a server.
  await page.setRequestInterception(true);
  page.on("request", req => {
    const url = req.url();
    if (url.endsWith("/_project.css")) return req.respond({ status: 200, contentType: "text/css", body: input.projectCss });
    if (url.endsWith("/styles.css")) return req.respond({ status: 200, contentType: "text/css", body: input.stylesCss });
    req.continue();
  });
  // Use the project dir as the page origin so relative asset paths (images, fonts) resolve.
  await page.goto(`file://${input.projectDir}/`, { waitUntil: "domcontentloaded" }).catch(() => { /* dir-only nav fails; ignored */ });
  await page.setContent(input.html, { waitUntil: "domcontentloaded" });
  const pagedJs = await readFile(pagedJsPath, "utf8");
  // Paged.js polyfills Paged Media; wait for its after-render event.
  await page.evaluate(`new Promise(resolve => {
    window.PagedConfig = { auto: false };
    ${pagedJs}
    const previewer = new window.PagedPolyfill.Previewer();
    previewer.preview(document.body.innerHTML, [], document.body)
      .then(() => resolve(undefined));
  })`);
  return page;
}

export async function renderHtml(input: RenderInput): Promise<string> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await setupPage(input, browser);
    return await page.content();
  } finally {
    await browser.close();
  }
}

export async function renderPdf(input: RenderInput): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await setupPage(input, browser);
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
```

**Step 5: Update `packages/render/src/index.ts`**

```typescript
export { renderHtml, renderPdf } from "./render.ts";
export type { RenderInput } from "./render.ts";
```

**Step 6: Run, see it pass.**

Run: `pnpm --filter @tender/render test`
Expected: PASS, takes 10–30 seconds (Chromium launch + Paged.js render).

> **NOTE:** Paged.js's preview API is sometimes finicky about how content is injected. If the test fails because the paged.js render didn't take effect, try the alternative pattern: inject the script tag with `auto: true` and listen for `pagedjs-after-render` via `page.evaluate(() => new Promise(r => document.addEventListener('pagedjs-after-render', r)))`. Adjust as needed; goal is a `.pagedjs_pages` element in the output.

**Step 7: Commit**

```bash
git add packages/render pnpm-lock.yaml
git commit -m "feat(render): renderHtml and renderPdf via Paged.js + Puppeteer"
```

### Task 1.8: Implement `tender build` CLI command

**Files:**
- Create: `packages/cli/src/cli.ts`
- Create: `packages/cli/src/commands/build.ts`
- Create: `packages/cli/src/commands/build.test.ts`
- Modify: `packages/cli/package.json`

**Step 1: Add deps**

```bash
pnpm --filter @tender/cli add commander @tender/core @tender/render
pnpm --filter @tender/cli add -D @types/node
```

In `packages/cli/package.json`, ensure dependencies on `@tender/core` and `@tender/render` use the workspace protocol:

```json
"dependencies": {
  "@tender/core": "workspace:*",
  "@tender/render": "workspace:*",
  "commander": "^12.0.0"
}
```

**Step 2: Failing test**

```typescript
// packages/cli/src/commands/build.test.ts
import { describe, it, expect } from "vitest";
import { build } from "./build.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
// Reuse the core fixture
const fixture = join(here, "../../../core/test/fixtures/hello");

describe("build command", () => {
  it("writes document.pdf and document.html to the out dir", async () => {
    const out = await mkdtemp(join(tmpdir(), "tender-build-"));
    await build({ projectDir: fixture, outDir: out });
    const pdfStat = await stat(join(out, "document.pdf"));
    expect(pdfStat.size).toBeGreaterThan(1000);
    const html = await readFile(join(out, "document.html"), "utf8");
    expect(html).toContain("Hello, Tender");
  }, 60_000);
});
```

**Step 3: Run, see it fail.**

**Step 4: Implement**

```typescript
// packages/cli/src/commands/build.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildProject } from "@tender/core";
import { renderHtml, renderPdf } from "@tender/render";

export interface BuildOptions {
  projectDir: string;
  outDir: string;
  pdfOnly?: boolean;
  htmlOnly?: boolean;
}

export async function build(opts: BuildOptions): Promise<void> {
  const result = await buildProject(opts.projectDir);
  await mkdir(opts.outDir, { recursive: true });
  if (!opts.pdfOnly) {
    const html = await renderHtml(result);
    await writeFile(join(opts.outDir, "document.html"), html);
  }
  if (!opts.htmlOnly) {
    const pdf = await renderPdf(result);
    await writeFile(join(opts.outDir, "document.pdf"), pdf);
  }
}
```

```typescript
// packages/cli/src/cli.ts
#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { build } from "./commands/build.ts";

const program = new Command();
program.name("tender").description("Print-layout tool for text documents");

program.command("build [dir]")
  .option("--out <path>", "output directory", "./out")
  .option("--pdf-only", "produce only PDF")
  .option("--html-only", "produce only HTML")
  .action(async (dir: string | undefined, opts) => {
    await build({
      projectDir: resolve(dir ?? "."),
      outDir: resolve(opts.out),
      pdfOnly: opts.pdfOnly,
      htmlOnly: opts.htmlOnly
    });
    console.log(`Built to ${resolve(opts.out)}`);
  });

program.parseAsync(process.argv);
```

**Step 5: Run, see it pass.**

**Step 6: Manual smoke test**

```bash
pnpm -r build
node packages/cli/dist/cli.js build packages/core/test/fixtures/hello --out /tmp/tender-out
ls /tmp/tender-out
```
Expected: `document.html` and `document.pdf` exist, both > 1KB.

Open the PDF in a viewer and confirm "Hello, Tender" appears as a heading on an A5 page.

**Step 7: Commit**

```bash
git add packages/cli pnpm-lock.yaml
git commit -m "feat(cli): tender build subcommand (vertical slice complete)"
```

**End of Phase 1 milestone:** Plain Markdown to PDF + HTML works end-to-end. Demo it before moving on.

---

## Phase 2 — Components and templates

End of phase: a project can declare simple components and Handlebars-style templates with named slots, and use them in source via Pandoc fenced divs. Inline `[text]{.classname}` works.

### Task 2.1: Extend `ProjectConfig` schema with `components` and `templates`

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`

**Step 1: Add tests for new fields**

```typescript
it("parses a component definition", () => {
  const c = ProjectConfig.parse({
    "page-templates": { default: { size: "A5", margin: 0 } },
    components: {
      callout: { tag: "aside", class: "callout", attrs: ["variant"] }
    }
  });
  expect(c.components?.callout.tag).toBe("aside");
});

it("parses a template definition with slots and params", () => {
  const c = ProjectConfig.parse({
    "page-templates": { default: { size: "A5", margin: 0 } },
    templates: {
      row: {
        params: ["label", "icon"],
        template: "<div class=\"row\">{{{body}}}</div>"
      },
      "ad-lib": {
        slots: ["suggested"],
        template: "<div>{{{suggested}}}</div>"
      }
    }
  });
  expect(c.templates?.row.params).toEqual(["label", "icon"]);
  expect(c.templates?.["ad-lib"].slots).toEqual(["suggested"]);
});
```

**Step 2: See them fail.**

**Step 3: Extend the schema**

```typescript
// packages/core/src/config/schema.ts (additions)
const Component = z.object({
  tag: z.string(),
  class: z.string().optional(),
  attrs: z.array(z.string()).optional(),
  inline: z.boolean().optional()
});

const Template = z.object({
  params: z.array(z.string()).optional(),
  slots: z.array(z.string()).optional(),
  template: z.string()
});

export const ProjectConfig = z.object({
  "page-templates": z.record(z.string(), PageTemplate)
    .refine(t => "default" in t, { message: "page-templates.default is required" }),
  components: z.record(z.string(), Component).optional(),
  templates: z.record(z.string(), Template).optional()
});
```

**Step 4: See them pass.**

**Step 5: Commit**

```bash
git add packages/core/src/config
git commit -m "feat(core): add components and templates to ProjectConfig"
```

### Task 2.2: Wire `remark-directive` into the Markdown parser

**Files:**
- Modify: `packages/core/src/parse/markdown.ts`
- Modify: `packages/core/src/parse/markdown.test.ts`

**Step 1: Failing test**

```typescript
it("preserves directive nodes for downstream handling", async () => {
  const html = await parseMarkdown(":::callout\nHello\n:::\n", { allowDirectives: true });
  // For now, the directive plugin without a transform leaves a custom element.
  expect(html).toContain("callout");
});
```

**Step 2: Add deps**

```bash
pnpm --filter @tender/core add remark-directive
```

**Step 3: Update `parseMarkdown`**

```typescript
import remarkDirective from "remark-directive";

export interface ParseOptions { allowDirectives?: boolean }

export async function parseMarkdown(source: string, opts: ParseOptions = {}): Promise<string> {
  let pipeline = unified().use(remarkParse);
  if (opts.allowDirectives) pipeline = pipeline.use(remarkDirective);
  const file = await pipeline.use(remarkRehype).use(rehypeStringify).process(source);
  return String(file);
}
```

**Step 4: See it pass.**

**Step 5: Commit**

```bash
git add packages/core/src/parse packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): wire remark-directive into parser (opt-in)"
```

### Task 2.3: Resolve simple components via a remark transform

**Files:**
- Create: `packages/core/src/parse/components.ts`
- Create: `packages/core/src/parse/components.test.ts`

The transform walks the mdast tree, finds `containerDirective`/`leafDirective`/`textDirective` nodes whose name matches a component, and rewrites them to HTML nodes with the configured tag/class/attrs.

**Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { parseProject } from "./project-parser.ts"; // we'll create a unified entry below
import type { ProjectConfig } from "../config/schema.ts";

const config: ProjectConfig = {
  "page-templates": { default: { size: "A5", margin: 0 } },
  components: {
    callout: { tag: "aside", class: "callout", attrs: ["variant"] },
    "stage-direction": { tag: "span", class: "stage-direction", inline: true }
  }
};

describe("component resolution", () => {
  it("rewrites a known block component", async () => {
    const html = await parseProject(":::callout{variant=warning}\nWatch out.\n:::\n", config);
    expect(html).toContain('<aside class="callout" data-variant="warning">');
    expect(html).toContain("Watch out.");
  });

  it("rewrites an inline component", async () => {
    const html = await parseProject("Note :stage-direction[whispers] here.", config);
    expect(html).toContain('<span class="stage-direction">whispers</span>');
  });

  it("errors on unknown component name", async () => {
    await expect(parseProject(":::unknown\nhi\n:::\n", config)).rejects.toThrow(/unknown component/i);
  });
});
```

**Step 2: See it fail.**

**Step 3: Implement**

Create `packages/core/src/parse/project-parser.ts` as the new entry point that takes a config and orchestrates `remark-parse` + `remark-directive` + the component-resolving transform + `remark-rehype` + `rehype-stringify`.

```typescript
// packages/core/src/parse/project-parser.ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { resolveComponents } from "./components.ts";
import type { ProjectConfig } from "../config/schema.ts";

export async function parseProject(source: string, config: ProjectConfig): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(resolveComponents, config)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(source);
  return String(file);
}
```

```typescript
// packages/core/src/parse/components.ts
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import type { ProjectConfig } from "../config/schema.ts";

export const resolveComponents: Plugin<[ProjectConfig], Root> = (config) => (tree) => {
  const components = config.components ?? {};
  visit(tree, (node) => {
    if (
      node.type !== "containerDirective" &&
      node.type !== "leafDirective" &&
      node.type !== "textDirective"
    ) return;
    const dir = node as { type: string; name: string; attributes?: Record<string, string>; data?: Record<string, unknown> };
    const def = components[dir.name];
    if (!def) {
      throw new Error(`Unknown component "${dir.name}"`);
    }
    if (def.inline && dir.type === "containerDirective") {
      throw new Error(`Component "${dir.name}" is inline-only; cannot use as a block`);
    }
    const data = (dir.data ??= {});
    data.hName = def.tag;
    const props: Record<string, string> = {};
    if (def.class) props.className = def.class;
    if (def.attrs && dir.attributes) {
      for (const k of def.attrs) {
        if (k in dir.attributes) props[`data-${k}`] = dir.attributes[k]!;
      }
    }
    data.hProperties = props;
  });
};
```

**Step 4: See tests pass.**

**Step 5: Add deps**

```bash
pnpm --filter @tender/core add unist-util-visit mdast
```

(If `mdast` types are needed via `@types/mdast`, add that instead.)

**Step 6: Commit**

```bash
git add packages/core/src/parse pnpm-lock.yaml packages/core/package.json
git commit -m "feat(core): resolve simple components via remark transform"
```

### Task 2.4: Resolve templates with single-slot bodies via Handlebars

**Files:**
- Create: `packages/core/src/parse/templates.ts`
- Create: `packages/core/src/parse/templates.test.ts`
- Modify: `packages/core/src/parse/project-parser.ts`

For Phase 2, support **single-slot templates only** (the `body` slot is implicit). Multi-slot comes in Task 2.5.

**Step 1: Add Handlebars dep**

```bash
pnpm --filter @tender/core add handlebars
```

**Step 2: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { parseProject } from "./project-parser.ts";
import type { ProjectConfig } from "../config/schema.ts";

const config: ProjectConfig = {
  "page-templates": { default: { size: "A5", margin: 0 } },
  templates: {
    row: {
      params: ["label", "icon"],
      template: `<div class="row">
  <div class="col-l">
    {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
  </div>
  <div class="col-r">{{{body}}}</div>
</div>`
    }
  }
};

describe("template resolution (single-slot)", () => {
  it("expands a template with a parameter and a body", async () => {
    const html = await parseProject(
      `:::row{label="45 min"}\n#### Stage 1\n\nThe welcome…\n:::\n`,
      config
    );
    expect(html).toContain('class="row"');
    expect(html).toContain('class="margin-label">45 min<');
    expect(html).toContain("<h4>Stage 1</h4>");
    expect(html).toContain("The welcome");
  });
});
```

**Step 3: See it fail.**

**Step 4: Implement**

Add a remark transform that runs **before** `remark-rehype` (so the body subtree is converted to HTML on its own) and replaces template directive nodes with raw HTML nodes containing the template-expanded markup.

```typescript
// packages/core/src/parse/templates.ts
import { unified } from "unified";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import Handlebars from "handlebars";
import type { Plugin } from "unified";
import type { Root, Parent } from "mdast";
import type { ProjectConfig } from "../config/schema.ts";

export const resolveTemplates: Plugin<[ProjectConfig], Root> = (config) => async (tree) => {
  const templates = config.templates ?? {};
  const compiled = new Map<string, Handlebars.TemplateDelegate>();
  for (const [name, def] of Object.entries(templates)) {
    compiled.set(name, Handlebars.compile(def.template, { strict: false }));
  }

  // Walk top-down; replace templates as we find them.
  await walkAndReplace(tree, async (node) => {
    if (
      node.type !== "containerDirective" &&
      node.type !== "leafDirective"
    ) return null;
    const dir = node as { name: string; attributes?: Record<string, string>; children?: Parent["children"] };
    const def = templates[dir.name];
    if (!def) return null; // not a template; let component resolver / unknown handler deal with it
    if (def.slots && def.slots.length > 0) return null; // multi-slot: handled in Task 2.5
    const fn = compiled.get(dir.name)!;
    const bodyHtml = await mdChildrenToHtml((node as Parent).children);
    const data: Record<string, unknown> = { body: bodyHtml };
    if (def.params && dir.attributes) {
      for (const p of def.params) data[p] = dir.attributes[p];
    }
    const html = fn(data);
    return { type: "html", value: html } as Parent["children"][number];
  });
};

async function mdChildrenToHtml(children: Parent["children"]): Promise<string> {
  const fakeRoot: Root = { type: "root", children };
  const file = await unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .run(fakeRoot)
    .then(node => unified().use(rehypeStringify, { allowDangerousHtml: true }).stringify(node as never));
  return String(file);
}

async function walkAndReplace(tree: Root, replacer: (node: any) => Promise<any | null>): Promise<void> {
  // Implement a simple async walk; depth-first, replace in parent's children array.
  async function recur(parent: Parent): Promise<void> {
    const children = parent.children as any[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const replacement = await replacer(child);
      if (replacement) { children[i] = replacement; continue; }
      if ("children" in child) await recur(child);
    }
  }
  await recur(tree);
}
```

Wire it into `project-parser.ts` between `remarkDirective` and `resolveComponents`:

```typescript
.use(remarkDirective)
.use(resolveTemplates, config)
.use(resolveComponents, config)
```

**Step 5: See it pass.**

**Step 6: Commit**

```bash
git add packages/core/src/parse pnpm-lock.yaml packages/core/package.json
git commit -m "feat(core): expand single-slot templates via Handlebars"
```

### Task 2.5: Multi-slot templates with `--- slot ---` sentinels

**Files:**
- Modify: `packages/core/src/parse/templates.ts`
- Modify: `packages/core/src/parse/templates.test.ts`

**Step 1: Failing test**

```typescript
it("expands a multi-slot template", async () => {
  const cfg: ProjectConfig = {
    "page-templates": { default: { size: "A5", margin: 0 } },
    templates: {
      "ad-lib": {
        slots: ["suggested"],
        template: `<div class="ad-lib"><div class="s">{{{suggested}}}</div><div class="b">your version</div></div>`
      }
    }
  };
  const src = `:::ad-lib
--- suggested ---
"Hello world."
:::
`;
  const html = await parseProject(src, cfg);
  expect(html).toContain('class="ad-lib"');
  expect(html).toContain('"Hello world."');
});

it("errors when a multi-slot template's required slot is missing", async () => {
  const cfg: ProjectConfig = {
    "page-templates": { default: { size: "A5", margin: 0 } },
    templates: { "ad-lib": { slots: ["suggested"], template: "<div></div>" } }
  };
  await expect(parseProject(`:::ad-lib\nno sentinels\n:::\n`, cfg)).rejects.toThrow(/missing slot/i);
});
```

**Step 2: See them fail.**

**Step 3: Extend `resolveTemplates`**

In the same walker, when `def.slots && def.slots.length > 0`:
1. Iterate the directive's children. Look for paragraph nodes whose first child is text matching `/^---\s+([\w-]+)\s+---$/`.
2. Each such paragraph starts a new slot section; subsequent siblings until the next sentinel (or end) are that slot's children.
3. Children before the first sentinel go into an implicit `body` slot if the template references `body`; otherwise they're an error.
4. After splitting, render each slot's children to HTML via `mdChildrenToHtml`, build the template data object, expand.
5. If a declared slot has no content, throw `Error("template <name>: missing slot <slot>")`.

This is mechanical — the implementer should write small helpers (`splitSlots(children)`, `renderSlots(slotMap)`) and unit-test each in isolation.

**Step 4: See tests pass.**

**Step 5: Commit**

```bash
git add packages/core/src/parse
git commit -m "feat(core): multi-slot templates via --- slot --- sentinels"
```

### Task 2.6: Hook the new parser into `buildProject`

**Files:**
- Modify: `packages/core/src/build.ts`
- Modify: `packages/core/src/build.test.ts`
- Create: `packages/core/test/fixtures/components/{project.yaml,styles.css,content.md}`

**Step 1: Create the fixture**

`project.yaml`:
```yaml
page-templates:
  default: { size: A5, margin: 12mm }
components:
  callout:
    tag: aside
    class: callout
    attrs: [variant]
templates:
  row:
    params: [label]
    template: |
      <div class="row">
        <div class="col-l">{{#if label}}<span>{{label}}</span>{{/if}}</div>
        <div class="col-r">{{{body}}}</div>
      </div>
```

`styles.css`:
```css
.row { display: grid; grid-template-columns: 1fr 2fr; gap: 8mm; }
.callout { padding: 1em; border-left: 3px solid #FFE600; }
```

`content.md`:
```markdown
# Components Demo

:::callout{variant=warning}
Watch your step.
:::

:::row{label="45 min"}
A row with a margin label.
:::
```

**Step 2: Failing test**

```typescript
it("builds a project that uses components and templates", async () => {
  const result = await buildProject(join(fixturesDir, "components"));
  expect(result.html).toContain('class="callout"');
  expect(result.html).toContain('data-variant="warning"');
  expect(result.html).toContain('class="row"');
  expect(result.html).toContain('class="col-l">');
});
```

**Step 3: Update `buildProject`** to call `parseProject` instead of `parseMarkdown`. See it pass.

**Step 4: Commit**

```bash
git add packages/core
git commit -m "feat(core): use parseProject (components+templates) in buildProject"
```

**End of Phase 2 milestone:** Components and templates work. Manually run `tender build packages/core/test/fixtures/components` and inspect the PDF.

---

## Phase 3 — Page templates, headers, footers, page numbers

End of phase: multiple named page templates with their own geometry and margin-box headers/footers. Page numbers, `{title}`, `{chapter}`, `{section}` tokens. Verso/recto via `:left`/`:right`. First-page suppression via `:first` and `headers-rest`.

### Task 3.1: Schema additions for headers/footers

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`

**Step 1: Test**

```typescript
it("parses headers/footers and verso/recto variants", () => {
  const c = ProjectConfig.parse({
    "page-templates": {
      default: {
        size: "A5", margin: 0,
        headers: {
          "left-page":  { left: "{page}", right: "{chapter}" },
          "right-page": { left: "{title}", right: "{page}" }
        },
        footers: { center: "{page}" }
      },
      "chapter-opener": {
        size: "A5", margin: 0,
        headers: "none",
        "headers-rest": { left: "{chapter}", right: "{title}" }
      }
    }
  });
  expect(c["page-templates"].default.headers).toBeTruthy();
  expect(c["page-templates"]["chapter-opener"].headers).toBe("none");
});
```

**Step 2: See it fail. Extend schema.** Add a `MarginBoxes` type (object with `left`/`center`/`right` strings, all optional), `HeaderConfig` = `MarginBoxes | { "left-page"?: MarginBoxes; "right-page"?: MarginBoxes } | "none"`, similar for `FooterConfig`. Add optional `headers`, `footers`, `headers-rest`, `footers-rest`, `bleed` to `PageTemplate`.

**Step 3: See it pass. Commit.**

### Task 3.2: Generate `@page` rules with margin boxes and `string-set`

**Files:**
- Modify: `packages/core/src/compose/project-css.ts`
- Modify: `packages/core/src/compose/project-css.test.ts`

For each named page template, emit:
- `@page <name> { size; margin; @top-left { content: ... } ... }` for the headers/footers.
- `@page <name>:left { ... }` and `@page <name>:right { ... }` if verso/recto variants exist.
- `@page <name>:first { ... }` for `headers: none` + `headers-rest`.
- `.page[data-page-template="<name>"] { page: <name>; }` for non-default; `.page { page: default; }` for default.

Add `string-set` rules on body elements so tokens like `{chapter}` work:

```css
h1 { string-set: chapter content(text); }
h2 { string-set: section content(text); }
title is set globally from the document title.
```

**Step 1–6:** TDD as above. The test writes a config with all these knobs, calls `generateProjectCss`, and asserts substrings (`@top-left`, `string(chapter)`, `counter(page)`, `:left`, `:right`, `:first`).

Token expansion in margin-box `content` values:
- `{page}` → `counter(page)`
- `{pages}` → `counter(pages)`
- `{chapter}` → `string(chapter)`
- `{section}` → `string(section)`
- `{title}` → `string(title)` (set via meta or in the composer using `@page { @top-center { content: "<title>"; } }` — actually, simplest is to inject as a CSS string variable from the composer)

For literal text in margin boxes, wrap in quotes; for tokens, expand. Mixed values like `"Page " {page}` need a small parser; v1 supports either pure literal or a single token, not mixed. (Add to non-goals if simpler.)

**Step 7: Commit.**

### Task 3.3: Built-in `page` template for applying page templates

**Files:**
- Modify: `packages/core/src/build.ts` (or wherever a "built-in templates" registry lives)
- Create: `packages/core/src/builtins.ts`
- Create: `packages/core/src/builtins.test.ts`

The `page` template is *always* available without being declared in `project.yaml`. It compiles to `<div class="page" data-page-template="{{template}}">{{{body}}}</div>` (or `<div class="page">{{{body}}}</div>` if `template` is omitted).

Source:
```
::: page template=chapter-opener
## Stage 1
:::
```

**Step 1: Test that the built-in is available without declaration.**
**Step 2: Add the built-in to the templates map at parse time, after user templates (user templates can override built-ins).**
**Step 3: Pass. Commit.**

### Task 3.4: End-to-end test for page templates

**Files:**
- Create: `packages/core/test/fixtures/page-templates/{project.yaml,styles.css,content.md}`
- Add tests to `packages/core/src/build.test.ts`

The fixture has two page templates (`default` and `chapter-opener`) and source that uses both. The integration test asserts `_project.css` contains both `@page` rules and that the rendered HTML has `data-page-template="chapter-opener"` on the right `<div class="page">`.

Manually verify with `node packages/cli/dist/cli.js build … --out /tmp/...` that the chapter-opener pages have a different top margin in the PDF.

Commit.

---

## Phase 4 — Hyphenation, fonts, asset paths

### Task 4.1: Schema for `typography` and `fonts`

**Files:**
- Modify: `packages/core/src/config/schema.ts` and its test.

Add `typography` (lang, hyphenation, orphans, widows) and `fonts` (array of `{ family, file, weight?, style? }`).

TDD. Commit.

### Task 4.2: Emit hyphenation CSS into `_project.css`

**Files:**
- Modify: `packages/core/src/compose/project-css.ts` and its test.

Emit:
```css
html { hyphens: auto; hyphenate-limit-chars: <minword> <before> <after>; hyphenate-limit-lines: <max>; }
```
And `lang` attribute injection in the composer (`composeDocument` already takes `lang`; just thread it from `typography.lang`).

TDD. Commit.

### Task 4.3: Emit `@font-face` rules and resolve font asset paths

**Files:**
- Modify: `packages/core/src/compose/project-css.ts` and its test.

For each `font` declaration, emit:
```css
@font-face {
  font-family: 'Display';
  src: url('assets/fonts/Display-Book.woff2') format('woff2');
  font-weight: 400; font-style: normal;
}
```

Asset paths are relative to the project dir; the render layer ensures Chromium resolves them via the `file://` origin set in Task 1.7.

TDD. Commit.

### Task 4.4: Image asset paths

Verify (with a fixture that includes an `assets/images/spiral.png`) that images referenced from `content.md` and template parameters resolve correctly in both PDF and HTML output. For HTML, base64-inline; for PDF, leave as file URLs.

Add a small `inlineAssets(html, projectDir)` helper in `@tender/render` (or `@tender/core/compose/inline-assets.ts`) that walks the rendered HTML, reads referenced images from disk, and rewrites `src` to `data:` URIs. Run it only in `renderHtml`, not `renderPdf`.

TDD. Commit.

---

## Phase 5 — `tender lint`, `tender preview`, `tender init`

### Task 5.1: `tender lint` command

**Files:**
- Create: `packages/cli/src/commands/lint.ts` and test.

Runs `loadProjectConfig` + `parseProject` on `content.md`, accumulates errors and warnings, prints them with file/line, exits non-zero if errors.

TDD. Commit.

### Task 5.2: Preview server

**Files:**
- Create: `packages/cli/src/commands/preview.ts` and tests.
- Add deps: `express`, `chokidar`, `ws`.

Express serves `/` (the rendered HTML, in HTML mode), `/styles.css`, `/_project.css`, and the project's `assets/` directory. A websocket on `/_tender` pushes a `reload` message whenever any watched file changes; an injected client script in the served HTML listens and calls `location.reload()`.

Test: start the server programmatically, fetch `/`, expect rendered HTML; touch `content.md`, expect a websocket message within 1s.

TDD. Commit.

### Task 5.3: `tender init`

**Files:**
- Create: `packages/cli/src/commands/init.ts` and tests.
- Create: starter templates under `packages/cli/templates/default/{project.yaml,styles.css,content.md}`.

Copies the starter template tree to the target directory; refuses if non-empty unless `--force`. The starter ships:
- `project.yaml` with `default` and `chapter-opener` page templates, `row` and `spanning-row` templates pre-declared, basic typography and one font slot.
- `styles.css` styling those primitives.
- `content.md` with a 3-page demo (cover, chapter opener, content with rows).

After `tender init demo && tender build demo`, the user gets a working PDF.

TDD. Commit.

---

## Phase 6 — Reproduce `example.html` as the integration acceptance test

### Task 6.1: Translate `example.html` into a Tender project

**Files:**
- Create: `packages/core/test/fixtures/coastal-planet/{project.yaml,styles.css,content.md,assets/...}`

Hand-port the example into Tender's source format. The `project.yaml` should declare:
- `page-templates`: `default` (A4, 12mm margin) and a `cover` template.
- `components`: `stage-direction`, `participant-name`, `yellow-tag`, `speaker-name`, `margin-label`.
- `templates`: `row` (params: `label`, `icon`, `speaker`, `no-break`), `spanning-row` (param: `rule`), `ad-lib` (slots: `suggested`).

Rewrite the source content as Markdown using these directives. Copy the icon images into `assets/images/`.

**Step 1: Write the project files.**

**Step 2: Manual smoke**

```bash
node packages/cli/dist/cli.js build packages/core/test/fixtures/coastal-planet --out /tmp/coastal
open /tmp/coastal/document.pdf
```

Compare visually against `example.html` rendered in a browser. They should look near-identical: same column layout, margin labels and icons, ad-lib boxes, page breaks, headers/footers.

Iterate on `project.yaml` and `styles.css` until visually matched. **Don't** modify the engine to make this work — if something genuinely can't be expressed, raise it as a design gap.

**Step 3: Add a snapshot test**

```typescript
// packages/core/src/build.test.ts (or a new integration.test.ts)
it("coastal-planet fixture: HTML output is structurally stable", async () => {
  const result = await buildProject(join(fixturesDir, "coastal-planet"));
  // Assert presence of key markers; don't snapshot the whole HTML — too fragile.
  expect(result.html).toContain('data-page-template="cover"');
  expect(result.html).toMatch(/class="row"/g); // multiple rows
  expect(result.html).toContain('class="ad-lib"');
});
```

**Step 4: PDF smoke**

```typescript
// packages/cli/src/commands/build.test.ts (or integration)
it("coastal-planet: produces a multi-page PDF", async () => {
  const out = await mkdtemp(...);
  await build({ projectDir: COASTAL, outDir: out });
  const pdf = await readFile(join(out, "document.pdf"));
  expect(pdf.length).toBeGreaterThan(50_000); // non-trivial doc
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
}, 90_000);
```

**Step 5: Commit**

```bash
git add packages/core/test/fixtures/coastal-planet
git commit -m "test: reproduce example.html as integration fixture"
```

### Task 6.2: Document v1 readiness

**Files:**
- Create: `README.md`

Write a short README covering: what Tender is, install, `tender init`, `tender build`, `tender preview`, link to the design doc and to `coastal-planet/` as the reference example. Note v1 limits (no PDF/X, no multi-file, etc.) and link to the roadmap section in the design doc.

Commit.

---

## Acceptance criteria

v1 is complete when all of the following hold:

1. `pnpm -r typecheck && pnpm -r build && pnpm -r test` passes locally and in CI.
2. `tender init demo && tender build demo` produces a non-trivial PDF and a self-contained HTML.
3. `tender preview demo` serves a live-reloading preview that visibly updates within 2s of saving any project file.
4. `tender lint demo-with-errors` reports all errors in `content.md` with file/line and exits non-zero.
5. The `coastal-planet` fixture builds to a PDF that visually matches the original `example.html` to a fair-witness eye (column layout, margin labels, page templates, ad-lib boxes, headers/footers).
6. README documents installation, the four CLI commands, and links to the design doc.

## What's deliberately not in v1

Confirm none of these have crept in. Each is a v2 task:

- Layout warnings (orphans/widows lints, bad-break detection).
- Multi-file content.
- In-source typographic markers (soft hyphens, NBSP, manual page breaks).
- PDF/X / CMYK / commercial prepress.
- ePub or other reflowable output.
- In-browser editing.
- Theme/component packages on npm.
- JS-based component definitions.
