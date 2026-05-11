# Multi-document projects — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let one Tender project carry multiple `*.md` documents at the root, all sharing the same component/style/token registry, selectable via a `--doc` CLI flag and a preview-UI dropdown.

**Architecture:** Documents are root-level `*.md` files (everything except `README.md` and `_*.md`). A new `listDocuments(projectDir)` enumerates them. `buildProject` is refactored to return one `BuildResult` per document (or just the named one). CLI `build`, `preview`, and `lint` gain a `--doc` flag; `build` with no flag builds them all. The preview server discovers docs, exposes them via `/_api/docs`, and the preview UI renders a switcher. Output filenames use the `.md` basename.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Commander, Express, ws, chokidar, SolidJS.

**Companion design:** [`2026-05-11-multi-document-projects-design.md`](./2026-05-11-multi-document-projects-design.md).

---

## Background reading (do this first)

Skim these so the rest of the plan reads cleanly:

- `docs/plans/2026-05-11-multi-document-projects-design.md` — the design we're implementing.
- `CLAUDE.md` — the doc-parity rules. This plan reserves explicit tasks for README / user-guide / SKILL updates; do not skip them.
- `packages/core/src/build.ts` — current single-doc pipeline.
- `packages/core/src/lint/index.ts` — current lint orchestrator.
- `packages/cli/src/commands/preview.ts` — preview server (express + ws + chokidar).
- `packages/preview-ui/src/App.tsx` — Solid app shell.

## Conventions

- **Commits:** one per task. Conventional commits (`feat(core): …`, `feat(cli): …`, `docs(user-guide): …`).
- **Branch:** keep working on `trunk`.
- **Tests:** every behaviour change has a failing test first. `pnpm --filter @tender/<pkg> test` runs one package; `pnpm test` runs the workspace.
- **Don't run `tender build` repeatedly** (30s cold-start). Use unit tests and the preview server.

---

## Task 1: `listDocuments` in core

Add a helper that enumerates `*.md` documents at a project root.

**Files:**
- Create: `packages/core/src/parse/list-documents.ts`
- Create: `packages/core/src/parse/list-documents.test.ts`
- Modify: `packages/core/src/index.ts` (export it)

**Step 1: Write the failing test**

```ts
// packages/core/src/parse/list-documents.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDocuments, RESERVED_DOC_NAMES } from "./list-documents.js";

async function fixture(files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-listdocs-"));
  for (const f of files) {
    if (f.includes("/")) {
      await mkdir(join(dir, f.split("/")[0]), { recursive: true });
    }
    await writeFile(join(dir, f), "");
  }
  return dir;
}

describe("listDocuments", () => {
  it("returns content.md as the only doc in a single-doc project", async () => {
    const dir = await fixture(["content.md", "project.yaml", "styles.css"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["content"]);
    expect(docs[0].isContent).toBe(true);
  });

  it("returns every root .md, sorted alphabetically, content.md first if present", async () => {
    const dir = await fixture(["resume.md", "cover-letter.md", "content.md"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["content", "cover-letter", "resume"]);
  });

  it("skips reserved names (README.md and _*.md)", async () => {
    const dir = await fixture(["README.md", "_draft.md", "resume.md"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["resume"]);
  });

  it("ignores .md files in subdirectories", async () => {
    const dir = await fixture(["resume.md", "components/x.md"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["resume"]);
  });

  it("returns [] when no documents exist", async () => {
    const dir = await fixture(["project.yaml"]);
    const docs = await listDocuments(dir);
    expect(docs).toEqual([]);
  });

  it("exposes the reserved-name set", () => {
    expect(RESERVED_DOC_NAMES.has("README.md")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```
pnpm --filter @tender/core test list-documents
```
Expected: FAIL — `listDocuments` not defined.

**Step 3: Implement**

```ts
// packages/core/src/parse/list-documents.ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const RESERVED_DOC_NAMES = new Set<string>(["README.md"]);

export interface ProjectDocument {
  /** Filename, e.g. "resume.md". */
  filename: string;
  /** Basename without extension, e.g. "resume". */
  basename: string;
  /** Absolute path. */
  path: string;
  /** True for content.md. */
  isContent: boolean;
}

/**
 * Discover documents at the project root. A document is any *.md file
 * directly in projectDir that is not reserved. Reserved: README.md and
 * any filename starting with "_". Subdirectories are ignored.
 *
 * Sort order: content.md first (if present), then the rest alphabetically.
 * That keeps a single-doc project's behaviour stable and gives multi-doc
 * projects a predictable default.
 */
export async function listDocuments(projectDir: string): Promise<ProjectDocument[]> {
  const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
  const docs: ProjectDocument[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".md")) continue;
    if (RESERVED_DOC_NAMES.has(e.name)) continue;
    if (e.name.startsWith("_")) continue;
    const basename = e.name.slice(0, -3);
    docs.push({
      filename: e.name,
      basename,
      path: join(projectDir, e.name),
      isContent: e.name === "content.md"
    });
  }
  docs.sort((a, b) => {
    if (a.isContent) return -1;
    if (b.isContent) return 1;
    return a.basename.localeCompare(b.basename);
  });
  return docs;
}
```

Add to `packages/core/src/index.ts`:

```ts
export { listDocuments, RESERVED_DOC_NAMES } from "./parse/list-documents.js";
export type { ProjectDocument } from "./parse/list-documents.js";
```

**Step 4: Run test to verify it passes**

```
pnpm --filter @tender/core test list-documents
```
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/parse/list-documents.ts packages/core/src/parse/list-documents.test.ts packages/core/src/index.ts
git commit -m "feat(core): listDocuments enumerates root *.md documents"
```

---

## Task 2: Refactor `buildProject` to accept a doc name

The current signature is `buildProject(projectDir) → BuildResult` and reads `content.md`. Make it `buildProject(projectDir, opts?) → BuildResult` where `opts.docName` selects which `.md` to read, defaulting to `content.md`. Attach the doc info to `BuildResult`.

We do NOT yet introduce a "build all" entry point — that's Task 5. This task keeps the existing one-result shape so render/preview keep working.

**Files:**
- Modify: `packages/core/src/build.ts`
- Modify: `packages/core/src/build.test.ts`

**Step 1: Read current tests**

```
pnpm --filter @tender/core test build.test
```

Confirm baseline passes.

**Step 2: Add failing tests**

Append to `packages/core/src/build.test.ts`:

```ts
it("builds the named document when opts.docName is given", async () => {
  const dir = await fixture({
    "project.yaml": "page-templates:\n  default:\n    size: A4\n",
    "styles.css": "",
    "content.md": "# Should not be picked",
    "resume.md": "# Resume"
  });
  const result = await buildProject(dir, { docName: "resume" });
  expect(result.html).toContain("Resume");
  expect(result.docBasename).toBe("resume");
  expect(result.docFilename).toBe("resume.md");
});

it("defaults to content.md when opts is omitted", async () => {
  const dir = await fixture({
    "project.yaml": "page-templates:\n  default:\n    size: A4\n",
    "styles.css": "",
    "content.md": "# Hi"
  });
  const result = await buildProject(dir);
  expect(result.docBasename).toBe("content");
});

it("throws a clear error when the named doc doesn't exist", async () => {
  const dir = await fixture({
    "project.yaml": "page-templates:\n  default:\n    size: A4\n",
    "styles.css": "",
    "content.md": "# Hi"
  });
  await expect(buildProject(dir, { docName: "missing" })).rejects.toThrow(/no document.*missing/i);
});
```

If a `fixture` helper isn't already in that file, add a minimal one that writes the given files to a tmpdir.

**Step 3: Run to verify they fail**

```
pnpm --filter @tender/core test build.test
```
Expected: FAIL — `docBasename` undefined etc.

**Step 4: Implement**

Update `packages/core/src/build.ts`:

```ts
export interface BuildResult {
  html: string;
  projectCss: string;
  componentsCss: string;
  stylesCss: string;
  config: ProjectConfig;
  projectDir: string;
  /** Basename without extension, e.g. "resume" or "content". */
  docBasename: string;
  /** Filename, e.g. "resume.md". */
  docFilename: string;
  timeoutMs?: number;
}

export interface BuildProjectOptions {
  /** Doc basename or filename (with or without .md). Defaults to "content". */
  docName?: string;
}

export async function buildProject(
  projectDir: string,
  opts: BuildProjectOptions = {}
): Promise<BuildResult> {
  const { config, registry } = await loadProjectRegistry(projectDir);
  const mergedComponents: Record<string, NonNullable<ProjectConfig["components"]>[string]> = {};
  for (const [name, entry] of registry.byName) {
    mergedComponents[name] = entry.def;
  }
  const mergedConfig: ProjectConfig = { ...config, components: mergedComponents };

  const docBasename = normaliseDocName(opts.docName ?? "content");
  const docFilename = `${docBasename}.md`;
  const md = await readFile(join(projectDir, docFilename), "utf8").catch(() => {
    throw new Error(`No document "${docBasename}" (looked for ${docFilename}) in ${projectDir}`);
  });
  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
  const { html: parsed, startsWithPage } = await parseProject(md, mergedConfig);
  const bodyHtml = startsWithPage ? parsed : `<div class="page">${parsed}</div>`;
  const lang = mergedConfig.typography?.lang ?? "en";
  // basename(projectDir) was the old title; keep the same shape so existing
  // styles/templates referring to the document title don't change.
  const html = composeDocument({ bodyHtml, lang, title: basename(projectDir) });
  const projectCss = generateProjectCss(mergedConfig, { docTitle: basename(projectDir) });
  const timeoutMs = mergedConfig.render?.["timeout-ms"];
  return {
    html,
    projectCss,
    componentsCss: registry.combinedCss,
    stylesCss,
    config: mergedConfig,
    projectDir,
    docBasename,
    docFilename,
    timeoutMs
  };
}

function normaliseDocName(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}
```

**Step 5: Verify tests pass**

```
pnpm --filter @tender/core test build.test
pnpm --filter @tender/core typecheck
```
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/core/src/build.ts packages/core/src/build.test.ts
git commit -m "feat(core): buildProject accepts docName and reports doc metadata"
```

---

## Task 3: Wire `--doc` flag through the CLI `build` command

`tender build` keeps its current shape but accepts `--doc <name>`. With no `--doc`, it builds every document (next task implements multi-build orchestration). For now, when `--doc` is omitted, fall through to the existing single-doc path (`content.md`); we'll switch to "build all" in Task 5 once the API exists.

**Why a half-step here?** Each step ships independently and stays test-covered. Don't expand scope.

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/build.ts`

**Step 1: Add tests for the new option**

Look for `packages/cli/src/commands/build.test.ts` — if missing, create one. Add:

```ts
it("passes --doc through to buildProject", async () => {
  const dir = await scaffold({
    "project.yaml": "page-templates:\n  default:\n    size: A4\n",
    "styles.css": "",
    "content.md": "# Default",
    "resume.md": "# Resume"
  });
  const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
  await build({ projectDir: dir, outDir, htmlOnly: true, docName: "resume" });
  const html = await readFile(join(outDir, "resume.html"), "utf8");
  expect(html).toContain("Resume");
});
```

(Provide a `scaffold` helper if one doesn't already exist in this test file.)

**Step 2: Run to verify failure**

```
pnpm --filter @tender/cli test build
```
Expected: FAIL.

**Step 3: Implement**

In `packages/cli/src/commands/build.ts`:

```ts
export interface BuildOptions {
  projectDir: string;
  outDir: string;
  pdfOnly?: boolean;
  htmlOnly?: boolean;
  docName?: string;
  timeoutMs?: number;
}

export async function build(opts: BuildOptions): Promise<void> {
  const result = await buildProject(opts.projectDir, { docName: opts.docName });
  const renderInput = opts.timeoutMs ? { ...result, timeoutMs: opts.timeoutMs } : result;
  await mkdir(opts.outDir, { recursive: true });
  const stem = result.docBasename;
  if (!opts.pdfOnly) {
    const html = await renderHtml(renderInput);
    await writeFile(join(opts.outDir, `${stem}.html`), html);
  }
  if (!opts.htmlOnly) {
    const pdf = await renderPdf(renderInput);
    await writeFile(join(opts.outDir, `${stem}.pdf`), pdf);
  }
}
```

In `packages/cli/src/cli.ts`, add `--doc` to the `build` command:

```ts
program
  .command("build [dir]")
  .description("Build PDF and HTML from a project directory")
  .option("--out <path>", "output directory", "./out")
  .option("--doc <name>", "build only the named document (basename without .md)")
  .option("--pdf-only", "produce only PDF")
  // ...
  .action(async (dir, opts) => {
    // existing validation...
    await build({
      projectDir: resolve(dir ?? "."),
      outDir: resolve(opts.out),
      docName: opts.doc,
      pdfOnly: opts.pdfOnly,
      htmlOnly: opts.htmlOnly,
      timeoutMs
    });
    // existing spinner / error handling
  });
```

**IMPORTANT:** Output filename for `content.md` is now `out/content.{pdf,html}` (not `out/document.*`). Any test that checks `out/document.pdf` needs updating in this commit.

**Step 4: Run tests, including the snapshot of any existing build test**

```
pnpm --filter @tender/cli test build
```
Update any tests that asserted on `document.pdf` / `document.html`.

**Step 5: Commit**

```bash
git add packages/cli/src/commands/build.ts packages/cli/src/cli.ts packages/cli/src/commands/build.test.ts
git commit -m "feat(cli): build --doc selects a document; output uses basename"
```

---

## Task 4: Update build help text and examples

Help text drift is a CLAUDE.md parity hazard. Capture it as its own commit so review is small.

**Files:**
- Modify: `packages/cli/src/cli.ts` (the `addHelpText` block for `build`)

**Step 1: Update examples**

```ts
.addHelpText(
  "after",
  `\nExamples:\n  $ tender build\n  $ tender build my-doc --pdf-only\n  $ tender build . --doc resume\n  $ tender build . --out dist --timeout 120000\n`
)
```

**Step 2: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "docs(cli): show --doc in tender build --help examples"
```

---

## Task 5: Build all documents when `--doc` is omitted

Add `buildProjectAll(projectDir)` that returns `BuildResult[]`. Refactor the CLI `build` command: with no `--doc`, iterate every doc; with `--doc`, behave as today.

**Files:**
- Modify: `packages/core/src/build.ts` (add `buildProjectAll`)
- Modify: `packages/core/src/index.ts` (export it)
- Modify: `packages/core/src/build.test.ts` (cover it)
- Modify: `packages/cli/src/commands/build.ts` (iterate)
- Modify: `packages/cli/src/commands/build.test.ts`

**Step 1: Failing test for `buildProjectAll`**

```ts
it("buildProjectAll returns one result per document, sorted with content.md first", async () => {
  const dir = await fixture({
    "project.yaml": "page-templates:\n  default:\n    size: A4\n",
    "styles.css": "",
    "content.md": "# Default",
    "resume.md": "# Resume",
    "cover-letter.md": "# Cover"
  });
  const results = await buildProjectAll(dir);
  expect(results.map(r => r.docBasename)).toEqual(["content", "cover-letter", "resume"]);
});

it("buildProjectAll returns [] when no documents exist", async () => {
  const dir = await fixture({
    "project.yaml": "page-templates:\n  default:\n    size: A4\n",
    "styles.css": ""
  });
  const results = await buildProjectAll(dir);
  expect(results).toEqual([]);
});
```

**Step 2: Failing test for CLI multi-build**

```ts
it("writes one output per doc when --doc is omitted", async () => {
  const dir = await scaffold({
    "project.yaml": "page-templates:\n  default:\n    size: A4\n",
    "styles.css": "",
    "content.md": "# Default",
    "resume.md": "# Resume"
  });
  const outDir = await mkdtemp(join(tmpdir(), "tender-build-out-"));
  await build({ projectDir: dir, outDir, htmlOnly: true });
  const files = await readdir(outDir);
  expect(files.sort()).toEqual(["content.html", "resume.html"]);
});
```

**Step 3: Verify failure**

```
pnpm --filter @tender/core test build.test
pnpm --filter @tender/cli test build
```
Expected: FAIL.

**Step 4: Implement `buildProjectAll`**

In `packages/core/src/build.ts`:

```ts
import { listDocuments } from "./parse/list-documents.js";

export async function buildProjectAll(projectDir: string): Promise<BuildResult[]> {
  const docs = await listDocuments(projectDir);
  const results: BuildResult[] = [];
  for (const d of docs) {
    results.push(await buildProject(projectDir, { docName: d.basename }));
  }
  return results;
}
```

Add to `packages/core/src/index.ts`:

```ts
export { buildProject, buildProjectAll } from "./build.js";
```

**Step 5: Implement CLI iteration**

In `packages/cli/src/commands/build.ts`:

```ts
import { buildProject, buildProjectAll, listDocuments } from "@tender/core";

export async function build(opts: BuildOptions): Promise<void> {
  await mkdir(opts.outDir, { recursive: true });
  const results = opts.docName
    ? [await buildProject(opts.projectDir, { docName: opts.docName })]
    : await buildProjectAll(opts.projectDir);

  if (results.length === 0) {
    throw new Error(`No documents found in ${opts.projectDir} (expected a *.md file at the project root).`);
  }

  for (const result of results) {
    const renderInput = opts.timeoutMs ? { ...result, timeoutMs: opts.timeoutMs } : result;
    const stem = result.docBasename;
    if (!opts.pdfOnly) {
      const html = await renderHtml(renderInput);
      await writeFile(join(opts.outDir, `${stem}.html`), html);
    }
    if (!opts.htmlOnly) {
      const pdf = await renderPdf(renderInput);
      await writeFile(join(opts.outDir, `${stem}.pdf`), pdf);
    }
  }
}
```

Update the CLI spinner message in `cli.ts` to reflect plurality:

```ts
const what = opts.pdfOnly ? "PDF" : opts.htmlOnly ? "HTML" : "PDF + HTML";
const spinner = startSpinner(opts.doc ? `Building ${what} for ${opts.doc}...` : `Building ${what}...`);
```

**Step 6: Tests pass**

```
pnpm --filter @tender/core test build.test
pnpm --filter @tender/cli test build
pnpm typecheck
```

**Step 7: Commit**

```bash
git add packages/core/src/build.ts packages/core/src/build.test.ts packages/core/src/index.ts \
        packages/cli/src/commands/build.ts packages/cli/src/commands/build.test.ts \
        packages/cli/src/cli.ts
git commit -m "feat(cli): tender build with no --doc builds every document"
```

---

## Task 6: Lint per document

Loop the per-document checks over every doc and pass `contentPath` to each. Keep `unused-component` cross-document (union of references).

**Files:**
- Modify: `packages/core/src/lint/index.ts`
- Modify: `packages/core/src/lint/checks/deprecated-syntax.ts`
- Modify: `packages/core/src/lint/checks/unknown-component.ts`
- Modify: `packages/core/src/lint/checks/missing-asset.ts`
- Modify: `packages/core/src/lint/checks/unused-component.ts`
- Modify the corresponding `.test.ts` files where they assume `content.md`.

**Step 1: Read each check's current contract**

Each check currently takes `{ projectDir, registry, contentMd }` and hard-codes the `content.md` path inside. We'll change to `{ projectDir, registry, contentMd, contentPath }`.

**Step 2: Failing integration test**

Add to a new `packages/core/src/lint/multi-doc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLint } from "./index.js";

async function projectFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-lint-multidoc-"));
  await writeFile(join(dir, "project.yaml"), "page-templates:\n  default:\n    size: A4\n");
  await writeFile(join(dir, "styles.css"), "");
  await mkdir(join(dir, "components"), { recursive: true });
  await writeFile(join(dir, "content.md"), "<unknown-a>x</unknown-a>");
  await writeFile(join(dir, "resume.md"), "<unknown-b>y</unknown-b>");
  return dir;
}

describe("lint across multiple documents", () => {
  it("reports unknown-component findings for every doc with the correct path", async () => {
    const dir = await projectFixture();
    const report = await runLint(dir);
    const paths = new Set(report.findings.map(f => f.path));
    expect(paths.has(join(dir, "content.md"))).toBe(true);
    expect(paths.has(join(dir, "resume.md"))).toBe(true);
  });
});
```

**Step 3: Verify failure**

```
pnpm --filter @tender/core test multi-doc
```

**Step 4: Refactor checks**

Each `check*` gets an extra `contentPath` field, replacing the hard-coded `join(input.projectDir, "content.md")`. Example for `unknown-component.ts`:

```ts
export interface UnknownComponentInput {
  projectDir: string;
  registry: ComponentRegistry;
  contentMd: string;
  contentPath: string;
}
export function checkUnknownComponent(input: UnknownComponentInput): LintFinding[] {
  // ... use input.contentPath where it currently uses join(input.projectDir, "content.md")
}
```

Same shape change for `missing-asset` and `deprecated-syntax`. `unused-component` already takes `{ registry, contentMd }`; widen to take all docs:

```ts
export interface UnusedComponentInput {
  registry: ComponentRegistry;
  /** Concatenated markdown across all docs (or a single doc for back-compat callers). */
  contentMd: string;
}
```

Concat is enough — the check is reachability-based and only cares about which tags are referenced anywhere.

**Step 5: Update `runLint`**

```ts
export async function runLint(projectDir: string): Promise<LintReport> {
  const findings: LintFinding[] = [];
  let registry;
  let config;
  try {
    ({ registry, config } = await loadProjectRegistry(projectDir));
  } catch (err) {
    return { findings: [/* unchanged */] };
  }

  // Forward registry-load diagnostics (unchanged).
  for (const d of registry.diagnostics) { /* unchanged */ }

  const docs = await listDocuments(projectDir);
  const docContents: { doc: ProjectDocument; md: string }[] = [];
  for (const doc of docs) {
    const md = await readFile(doc.path, "utf8").catch(() => "");
    docContents.push({ doc, md });
  }

  // Per-doc checks.
  for (const { doc, md } of docContents) {
    findings.push(...checkUnknownComponent({ projectDir, registry, contentMd: md, contentPath: doc.path }));
    findings.push(...await checkMissingAsset({ projectDir, registry, contentMd: md, contentPath: doc.path }));
    findings.push(...checkDeprecatedSyntax({ projectDir, registry, contentMd: md, contentPath: doc.path }));
  }

  // Cross-doc: unused-component sees every doc's references.
  const allMd = docContents.map(d => d.md).join("\n");
  findings.push(...checkUnusedComponent({ registry, contentMd: allMd }));

  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
  const consumedCss = stylesCss + "\n" + registry.combinedCss;
  findings.push(...checkTokens({ projectDir, tokens: config["design-tokens"], consumedCss }));

  return { findings };
}
```

**Step 6: Fix any test files that called the checks directly**

The existing per-check tests pass `contentMd` but no `contentPath`. Add `contentPath: join(projectDir, "content.md")` to keep their behaviour, or update the assertion paths.

**Step 7: All tests pass**

```
pnpm --filter @tender/core test lint
pnpm --filter @tender/core typecheck
```

**Step 8: Commit**

```bash
git add packages/core/src/lint
git commit -m "feat(core): lint every root document; checks take contentPath"
```

---

## Task 7: Preview server discovers and serves multiple docs

The server keeps one `BuildResult` per doc, plus exposes the discovered list via `/_api/docs`. The websocket `content` message carries a `doc` field so the client can decide whether to reload.

The rendered preview at `/_preview` now accepts a `?doc=<name>` query param. The renderer caches one HTML per doc.

**Files:**
- Modify: `packages/cli/src/commands/preview.ts`
- Modify: `packages/cli/src/commands/preview.test.ts`

**Step 1: Failing test**

```ts
it("exposes /_api/docs with the discovered set", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tender-preview-multi-"));
  await writeFile(join(tmp, "project.yaml"), "page-templates:\n  default:\n    size: A4\n");
  await writeFile(join(tmp, "content.md"), "# Default");
  await writeFile(join(tmp, "resume.md"), "# Resume");
  const server = await startPreviewServer({ projectDir: tmp, port: 0 });
  try {
    const res = await fetch(`http://${server.host}:${server.port}/_api/docs`);
    const json = await res.json();
    expect(json.docs.map((d: any) => d.basename)).toEqual(["content", "resume"]);
    expect(json.default).toBe("content");
  } finally {
    await server.close();
  }
});

it("serves the requested doc at /_preview?doc=<name>", async () => {
  // ... fetch /_preview?doc=resume, assert HTML contains "Resume"
});
```

**Step 2: Implement**

In `packages/cli/src/commands/preview.ts`:

```ts
import { buildProject, buildProjectAll, listDocuments, type ProjectDocument } from "@tender/core";

// Replace cachedHtml / cachedBuildResult with per-doc caches.
const docCaches = new Map<string, { html: string; build: BuildResult }>();
let docs: ProjectDocument[] = [];

async function discoverDocs(): Promise<void> {
  docs = await listDocuments(opts.projectDir);
}

async function rebuild(docName?: string): Promise<void> {
  // Refresh the doc list each rebuild — a new .md file should appear.
  await discoverDocs();
  const target = docName
    ? docs.filter(d => d.basename === docName)
    : docs;
  for (const doc of target) {
    try {
      const build = await buildProject(opts.projectDir, { docName: doc.basename });
      const html = await renderSession.renderHtml(build);
      docCaches.set(doc.basename, { html: injectPreviewExtras(html), build });
      buildError = null;
    } catch (err) {
      buildError = err instanceof Error ? err : new Error(String(err));
      // Show the error in the preview for this doc.
      docCaches.set(doc.basename, {
        html: `<!DOCTYPE html><html><body><pre>Build error: ${escapeHtml(buildError.message)}</pre>${RELOAD_SCRIPT}</body></html>`,
        build: docCaches.get(doc.basename)?.build ?? (null as any)
      });
    }
  }
}

// /_api/docs
app.get("/_api/docs", (_req, res) => {
  res.json({
    docs: docs.map(d => ({
      basename: d.basename,
      filename: d.filename,
      isContent: d.isContent
    })),
    default: docs[0]?.basename ?? null
  });
});

// /_preview accepts ?doc=<name>; defaults to first doc.
app.get("/_preview", (req, res) => {
  const requested = typeof req.query.doc === "string" ? req.query.doc : undefined;
  const name = requested ?? docs[0]?.basename;
  const cached = name ? docCaches.get(name) : undefined;
  res.type("html").send(cached?.html ?? "");
});

// The other /_api/* endpoints that use cachedBuildResult need a doc query
// too, or fall back to the first doc's build (project.css, components.css
// are the same across docs so this still works; the call signature stays).
```

For the **WS messages**, widen:

```ts
type WsMessage =
  | { kind: "content"; doc: string }      // include which doc changed
  | { kind: "project" }
  | { kind: "components" }
  | { kind: "styles" }
  | { kind: "help" }
  | { kind: "assets" }
  | { kind: "docs" }                       // doc added/removed
  | { kind: "error"; message: string };

function classifyPath(path: string, projectDir: string): { kind: WsMessage["kind"]; doc?: string } {
  const rel = path.startsWith(projectDir) ? path.slice(projectDir.length + 1) : path;
  if (rel === "project.yaml") return { kind: "project" };
  if (rel === "styles.css") return { kind: "styles" };
  if (rel.startsWith("docs/user-guide.md") || rel.startsWith("docs" + sep + "user-guide.md")) return { kind: "help" };
  if (rel.startsWith("assets/") || rel.startsWith("assets" + sep)) return { kind: "assets" };
  if (rel.startsWith("components/") || rel.startsWith("components" + sep)) return { kind: "components" };
  // Any root *.md is a content event.
  if (rel.endsWith(".md") && !rel.includes(sep) && !rel.startsWith("_") && rel !== "README.md") {
    return { kind: "content", doc: rel.slice(0, -3) };
  }
  return { kind: "content", doc: docs[0]?.basename ?? "content" };
}
```

The watcher handler triggers a per-doc rebuild on `kind === "content"`, and a full rebuild on others. When a new `.md` appears (chokidar `add` event), emit `kind: "docs"` after rebuilding it so the UI re-fetches the doc list.

**Step 3: Tests pass**

```
pnpm --filter @tender/cli test preview
```

**Step 4: Commit**

```bash
git add packages/cli/src/commands/preview.ts packages/cli/src/commands/preview.test.ts
git commit -m "feat(cli): preview server discovers root *.md docs and serves them per-doc"
```

---

## Task 8: `tender preview --doc <name>`

The flag preselects which doc the preview UI loads first. (UI still shows the dropdown to switch.)

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/preview.ts` (accept `opts.docName`, expose it via `/_api/docs` as `default`)

**Step 1: Validation**

If `--doc` is passed and no `.md` matches, fail with a list of available docs before binding the port.

**Step 2: Tests**

```ts
it("fails fast when --doc points at a non-existent document", async () => {
  // ... assert it throws with a helpful list
});

it("/_api/docs reports the --doc name as default", async () => {
  // ...
});
```

**Step 3: Implementation**

```ts
// in cli.ts preview action:
const docName = opts.doc;
if (docName) {
  const docs = await listDocuments(projectDir);
  if (!docs.some(d => d.basename === normalise(docName))) {
    console.error(`${red("error")}: no document "${docName}". Available: ${docs.map(d => d.basename).join(", ") || "(none)"}`);
    process.exit(2);
  }
}
// pass docName into startPreviewServer
```

`startPreviewServer` stores `opts.docName` and returns it as `default` from `/_api/docs` when set.

**Step 4: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/commands/preview.ts packages/cli/src/commands/preview.test.ts
git commit -m "feat(cli): preview --doc preselects a document"
```

---

## Task 9: Preview UI dropdown

Add a doc switcher to the existing `TabBar` (or a sibling control in the header chrome). Fetches `/_api/docs` on mount, persists the selection in local state, and reloads the iframe with `?doc=<name>` on change.

**Files:**
- Modify: `packages/preview-ui/src/App.tsx`
- Modify: `packages/preview-ui/src/tabs/Preview.tsx` (accept `doc` prop on the iframe src)
- Possibly: `packages/preview-ui/src/components/TabBar.tsx` (add the dropdown next to the tabs)
- Modify: `packages/preview-ui/src/api.ts` (add `fetchDocs()`)
- Modify: `packages/preview-ui/src/reload-context.ts` if the WS payload shape change requires it.

**Step 1: API helper**

```ts
// packages/preview-ui/src/api.ts
export interface DocsResponse {
  docs: { basename: string; filename: string; isContent: boolean }[];
  default: string | null;
}

export async function fetchDocs(): Promise<DocsResponse> {
  const res = await fetch("/_api/docs");
  if (!res.ok) throw new Error(`/_api/docs ${res.status}`);
  return res.json();
}
```

**Step 2: Wire up the App**

In `App.tsx`:

```ts
const [docs, setDocs] = createSignal<DocsResponse["docs"]>([]);
const [currentDoc, setCurrentDoc] = createSignal<string | null>(null);

onMount(async () => {
  const r = await fetchDocs();
  setDocs(r.docs);
  setCurrentDoc(r.default);
});

// React to WS `kind: "docs"` events by re-fetching.
// React to WS `kind: "content", doc: <name>` by reloading only if doc === currentDoc.
```

`PreviewIframe` takes `currentDoc()` and uses `<iframe src={`/_preview?doc=${doc}`} />`. On reload, swap the src.

**Step 3: Dropdown UI**

Hide the dropdown when `docs().length <= 1` — single-doc projects keep the existing chrome unchanged.

```tsx
<Show when={docs().length > 1}>
  <select value={currentDoc() ?? ""} onChange={e => setCurrentDoc(e.currentTarget.value)}>
    <For each={docs()}>{d => <option value={d.basename}>{d.basename}</option>}</For>
  </select>
</Show>
```

**Step 4: Tests**

Add a Vitest test using JSDOM (this package already has tests like `api.test.ts`):

```ts
it("fetchDocs hits /_api/docs and returns the JSON body", async () => {
  // mock fetch
});
```

A full DOM test of the dropdown is overkill — keep manual verification.

**Step 5: Manual check**

```
pnpm --filter @tender/preview-ui build
pnpm --filter @tender/cli build
# in a multi-doc fixture:
node packages/cli/dist/cli.js preview
```

Open the URL, confirm the dropdown lists every doc, and that switching changes the visible PDF.

**Step 6: Commit**

```bash
git add packages/preview-ui
git commit -m "feat(preview-ui): doc switcher dropdown when project has multiple docs"
```

---

## Task 10: `lint` and `clean` CLI updates

`lint` already iterates per Task 6; no CLI changes needed for it. `clean` in a multi-doc project with no positional arg should error out with a list.

**Files:**
- Modify: `packages/cli/src/commands/clean.ts`
- Modify: `packages/cli/src/cli.ts`

**Step 1: Failing test**

```ts
it("errors with the doc list when no path is given in a multi-doc project", async () => {
  // ... assert exitCode !== 0 and message mentions both doc names
});

it("uses content.md when only content.md exists", async () => {
  // ... existing behaviour preserved
});
```

**Step 2: Implement**

In `cli.ts`:

```ts
.action(async (path, opts) => {
  let target = path ? resolve(path) : null;
  if (!target) {
    const docs = await listDocuments(process.cwd());
    if (docs.length > 1) {
      console.error(`${red("error")}: multiple documents found — pass a path. Available: ${docs.map(d => d.filename).join(", ")}`);
      process.exit(2);
    }
    target = resolve(docs[0]?.filename ?? "content.md");
  }
  // existing flow
});
```

**Step 3: Commit**

```bash
git add packages/cli/src/commands/clean.ts packages/cli/src/cli.ts packages/cli/src/commands/clean.test.ts
git commit -m "feat(cli): tender clean in multi-doc projects requires explicit path"
```

---

## Task 11: Add a multi-doc fixture

Anchors the behaviour in `pnpm test` and serves as a real example.

**Files:**
- Create: `packages/core/test/fixtures/coastal-multi-doc/project.yaml`
- Create: `packages/core/test/fixtures/coastal-multi-doc/styles.css`
- Create: `packages/core/test/fixtures/coastal-multi-doc/components/` (one component)
- Create: `packages/core/test/fixtures/coastal-multi-doc/content.md`
- Create: `packages/core/test/fixtures/coastal-multi-doc/resume.md`
- Create: `packages/core/test/fixtures/coastal-multi-doc/cover-letter.md`

Use a small subset of `coastal-planet-tags`'s setup. Each `.md` references the shared component to prove the registry is reused.

**Step 1: Snapshot test**

```ts
// packages/core/src/build.test.ts (or a dedicated file)
it("multi-doc fixture builds one BuildResult per .md", async () => {
  const dir = join(__dirname, "..", "test", "fixtures", "coastal-multi-doc");
  const results = await buildProjectAll(dir);
  expect(results.map(r => r.docBasename)).toEqual(["content", "cover-letter", "resume"]);
  for (const r of results) {
    expect(r.html).toContain("<html");
  }
});
```

**Step 2: Commit**

```bash
git add packages/core/test/fixtures/coastal-multi-doc packages/core/src/build.test.ts
git commit -m "test(core): coastal-multi-doc fixture covers multi-doc build"
```

---

## Task 12: Documentation parity (REQUIRED — CLAUDE.md gate)

Three places must be updated **in the same PR as the code**:

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.md`
- Modify: `claude/skills/tender-author/SKILL.md`

**README.md changes:**

- In the project layout example, add `cover-letter.md` and `resume.md` siblings under the root, with a short comment.
- In the commands list, add the `--doc` flag for `build` and `preview`.
- Mention that the default output filename matches the markdown basename (so single-doc projects now produce `out/content.pdf` instead of `out/document.pdf`).

**docs/user-guide.md changes:**

- New section: "Multiple documents". Cover: how a document is discovered (root `*.md`), reserved names, the `--doc` flag, default behaviour (build all), output naming, lint behaviour, preview UI.
- Update CLI reference for `tender build`, `tender preview`, `tender clean` with `--doc` and the multi-doc flow.
- Note the back-compat break for `out/document.pdf` → `out/content.pdf`.

**SKILL.md changes:**

- Project-shape recap mentions root-level `*.md` as documents (not just `content.md`).
- CLI commands the skill references gain `--doc` where applicable.
- Add a sentence under "common diagnoses": if a finding's path is `cover-letter.md`, that's the document in question (already the existing reporting behaviour, but worth a one-liner).

**Step 1: Make changes**

Edit each file in turn.

**Step 2: Sanity-check**

Re-read each file end-to-end after editing. Watch for stale references to `content.md` as the only doc.

**Step 3: Commit**

```bash
git add README.md docs/user-guide.md claude/skills/tender-author/SKILL.md
git commit -m "docs: multi-document projects across README, user-guide, skill"
```

---

## Task 13: Final verification

**Step 1: Workspace tests**

```
pnpm test
pnpm typecheck
```
Expected: PASS across all packages.

**Step 2: Smoke-build the CLI**

```
pnpm --filter @tender/cli build
```

**Step 3: Smoke-test in the multi-doc fixture**

```
cd packages/core/test/fixtures/coastal-multi-doc
node ../../../../cli/dist/cli.js build --html-only --out /tmp/tender-multi-out
ls /tmp/tender-multi-out
# Expect: content.html, cover-letter.html, resume.html
```

```
node ../../../../cli/dist/cli.js build --html-only --doc resume --out /tmp/tender-one-out
ls /tmp/tender-one-out
# Expect: just resume.html
```

**Step 4: Smoke-test preview UI manually**

```
node ../../../../cli/dist/cli.js preview --port 0
```

Open the printed URL, confirm:
- Dropdown shows all three docs.
- Default = content.
- Switching docs swaps the rendered preview.
- Editing `resume.md` triggers reload only when resume is the visible doc.
- Editing `styles.css` reloads whatever doc is visible.

**Step 5: Verify nothing left checking `document.pdf`**

```
grep -rn "document\.pdf\|document\.html" packages/ docs/ README.md
```

Anything that's a test or a doc still asserting the old name needs updating now.

**Step 6: Commit any final fixes**

```bash
git commit -am "chore: cleanup straggling references to document.pdf"
```

---

## Done criteria

- [ ] `listDocuments` enumerates root `*.md` correctly, content.md first.
- [ ] `buildProject(projectDir, { docName })` works for any doc; `buildProjectAll` returns N results.
- [ ] `tender build --doc resume` writes only `out/resume.{pdf,html}`.
- [ ] `tender build` with no flag writes one set of outputs per doc.
- [ ] `tender preview` exposes `/_api/docs`, the UI shows a switcher when there are 2+ docs, and edits to a non-visible doc don't force a reload.
- [ ] `tender preview --doc resume` preselects resume; bad name exits with a list.
- [ ] `tender lint` reports findings against every doc with the right path.
- [ ] `tender clean` in a multi-doc project requires an explicit path.
- [ ] README, user-guide, and SKILL.md all reflect the new behaviour.
- [ ] `pnpm test` and `pnpm typecheck` pass.
- [ ] Smoke build + preview verified manually on the multi-doc fixture.

## YAGNI reminders

Do not, in this plan:

- Add per-doc frontmatter or per-doc token overrides.
- Add a `documents:` key to `project.yaml`.
- Combine docs into a single PDF.
- Support per-doc `assets/` subfolders.
- Add a CLI command like `tender build --watch`.

If a real need shows up later, it's a follow-up plan.
