# Tender Preview UI — Wave A Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-page `tender preview` with a tabbed Solid+Vite SPA that has Preview / Palette / Help tabs, while keeping the existing Paged.js render flow untouched.

**Architecture:** New `@tender/preview-ui` package (Solid + Vite) builds a static SPA bundle. The existing `@tender/cli` preview server serves the bundle from `/`, the existing Paged.js output from `/_preview`, and JSON APIs at `/_api/palette`, `/_api/help`. The Preview tab embeds `/_preview` as an iframe (Paged.js needs its own DOM). Palette tiles use Shadow DOM to isolate project CSS. Live reload becomes a typed WS message so the SPA can selectively re-fetch.

**Tech Stack:** Solid 1.x + Solid Router, Vite 5.x, TypeScript (existing), Vitest + @solidjs/testing-library + jsdom for unit, Playwright for one E2E smoke. No styling framework — plain CSS in `preview-ui/src/styles.css`.

**Reference:** [`docs/plans/2026-05-08-tender-ui-expansion-design.md`](2026-05-08-tender-ui-expansion-design.md)

---

## How to use this plan

- Each task lists exact files, exact commands, and exact expected output. Don't batch.
- Conventions established by Phase 0–6 of the v1 plan still apply: ESM `module: NodeNext`, `.js` import extensions for relative paths, tests next to source, `noUncheckedIndexedAccess: true`. Solid components use `.tsx`.
- All checks must stay clean across the workspace: `pnpm -r typecheck && pnpm -r build && pnpm -r test`.
- **Safety**: this machine runs production code. No `pkill`/`killall`/broad process termination. Bind test servers to port 0. Always close servers in test `finally` blocks.
- The plan is grouped into phases; each phase ends with a runnable artifact. Don't move on if the artifact doesn't work.

---

## Phase 0 — Schema & API foundations (no UI yet)

End of phase: the existing CLI has new endpoints (`/_api/palette`, `/_api/help`, `/_api/styles.css`, `/_api/_project.css`) and the WebSocket emits typed messages. Tests cover them. No SPA yet.

This phase is order-sensitive: the schema additions must land before the API endpoints can use them.

### Task 0.1: Add `palette` block to component/template schema

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`

`palette` is metadata; it never affects build output but must validate cleanly.

**Step 1: Add failing tests**

In `packages/core/src/config/schema.test.ts`, add:

```typescript
it("accepts a palette block on a component", () => {
  const c = ProjectConfig.parse({
    "page-templates": { default: { size: "A5", margin: 0 } },
    components: {
      callout: {
        tag: "aside",
        class: "callout",
        attrs: ["variant"],
        palette: {
          attrs: { variant: "warning" },
          body: "Watch your step.",
          variants: [
            { attrs: { variant: "info" }, body: "Info." }
          ]
        }
      }
    }
  });
  expect(c.components?.callout?.palette?.attrs?.variant).toBe("warning");
  expect(c.components?.callout?.palette?.variants?.[0]?.body).toBe("Info.");
});

it("accepts a palette block on a template with params and slots", () => {
  const c = ProjectConfig.parse({
    "page-templates": { default: { size: "A5", margin: 0 } },
    templates: {
      "ad-lib": {
        slots: ["suggested"],
        template: "<div>{{{suggested}}}</div>",
        palette: {
          slots: { suggested: "Hello." },
          variants: [{ slots: { suggested: "Goodbye." } }]
        }
      }
    }
  });
  expect(c.templates?.["ad-lib"]?.palette?.slots?.suggested).toBe("Hello.");
});
```

**Step 2: Run** — should FAIL with parse errors.

```
pnpm --filter @tender/core test
```

**Step 3: Extend the schema**

In `packages/core/src/config/schema.ts`, add a `Palette` schema and attach it to `Component` and `Template`:

```typescript
const PaletteVariant = z.object({
  attrs: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional()
});

const Palette = z.object({
  attrs: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional(),
  variants: z.array(PaletteVariant).optional()
});

const Component = z.object({
  tag: z.string(),
  class: z.string().optional(),
  attrs: z.array(z.string()).optional(),
  inline: z.boolean().optional(),
  palette: Palette.optional()
});

const Template = z.object({
  params: z.array(z.string()).optional(),
  slots: z.array(z.string()).optional(),
  template: z.string(),
  palette: Palette.optional()
});
```

**Step 4: Run** — should PASS. Verify all existing schema tests still pass.

**Step 5: Commit**

```
git add packages/core/src/config
git commit -m "feat(core): schema for component/template palette overrides"
```

### Task 0.2: Placeholder content generator

**Files:**
- Create: `packages/core/src/palette/placeholders.ts`
- Create: `packages/core/src/palette/placeholders.test.ts`

A small library of generic English filler sentences. Used when no `palette` override is given.

**Step 1: Failing test**

```typescript
// packages/core/src/palette/placeholders.test.ts
import { describe, it, expect } from "vitest";
import { placeholderBody, placeholderAttr } from "./placeholders.js";

describe("placeholderBody", () => {
  it("returns a non-empty English string", () => {
    const s = placeholderBody();
    expect(s.length).toBeGreaterThan(20);
    expect(s).toMatch(/[a-z]/i);
  });

  it("returns deterministic output for a given seed", () => {
    expect(placeholderBody(0)).toBe(placeholderBody(0));
    expect(placeholderBody(0)).not.toBe(placeholderBody(1));
  });
});

describe("placeholderAttr", () => {
  it("returns the first declared enum value when known", () => {
    expect(placeholderAttr("variant", ["warning", "info"])).toBe("warning");
  });

  it("returns 'sample' for an unconstrained attr", () => {
    expect(placeholderAttr("speaker")).toBe("sample");
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```typescript
// packages/core/src/palette/placeholders.ts
const SENTENCES = [
  "This is what the body content looks like inside this component.",
  "A second example, slightly longer to show how multi-line prose wraps within the available space.",
  "Component previews use real readable English so you can judge typography and rhythm.",
  "Lorem ipsum was avoided here on purpose — it makes spacing and break behavior harder to assess.",
  "Edit the palette block in project.yaml to override this with your own example text."
];

export function placeholderBody(seed = 0): string {
  return SENTENCES[seed % SENTENCES.length]!;
}

export function placeholderAttr(_name: string, allowed?: string[]): string {
  if (allowed && allowed.length > 0) return allowed[0]!;
  return "sample";
}
```

**Step 4: Run** — PASS.

**Step 5: Commit**

```
git add packages/core/src/palette
git commit -m "feat(core): placeholder content for palette tiles"
```

### Task 0.3: `buildPalette` — pre-render all components/templates with placeholders

**Files:**
- Create: `packages/core/src/palette/build-palette.ts`
- Create: `packages/core/src/palette/build-palette.test.ts`

This is the data-producing function the new `/_api/palette` endpoint will call. It takes a parsed `ProjectConfig` and returns a `PaletteResponse` with pre-rendered HTML for each entry.

**Step 1: Failing test**

```typescript
// packages/core/src/palette/build-palette.test.ts
import { describe, it, expect } from "vitest";
import { buildPalette } from "./build-palette.js";
import type { ProjectConfig } from "../config/schema.js";

describe("buildPalette", () => {
  it("produces a tile for each declared component", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        callout: { tag: "aside", class: "callout", attrs: ["variant"] }
      }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    expect(palette.components.length).toBe(1);
    const c = palette.components[0]!;
    expect(c.name).toBe("callout");
    expect(c.kind).toBe("component");
    expect(c.meta.tag).toBe("aside");
    expect(c.renders[0]?.html).toContain('<aside');
    expect(c.renders[0]?.html).toContain('class="callout"');
    expect(c.renders[0]?.snippet).toContain(":::callout");
  });

  it("uses palette overrides when declared", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        callout: {
          tag: "aside", class: "callout", attrs: ["variant"],
          palette: {
            attrs: { variant: "warning" },
            body: "Watch your step.",
            variants: [{ attrs: { variant: "info" }, body: "Info." }]
          }
        }
      }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    const c = palette.components[0]!;
    expect(c.renders.length).toBe(2);
    expect(c.renders[0]?.html).toContain('data-variant="warning"');
    expect(c.renders[0]?.html).toContain('Watch your step');
    expect(c.renders[1]?.html).toContain('data-variant="info"');
    expect(c.renders[1]?.label).toBe('variant 1');
  });

  it("produces a tile for each declared template", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      templates: {
        row: {
          params: ["label"],
          template: '<div class="row"><span>{{label}}</span><div>{{{body}}}</div></div>'
        }
      }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    expect(palette.templates.length).toBe(1);
    const t = palette.templates[0]!;
    expect(t.renders[0]?.html).toContain('class="row"');
    expect(t.renders[0]?.snippet).toMatch(/^:::row/);
  });

  it("includes a fixed typography specimen", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    const ids = palette.typography.map(t => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["h1", "h2", "h3", "h4", "p", "ul", "ol", "blockquote", "pre", "hr"])
    );
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```typescript
// packages/core/src/palette/build-palette.ts
import { parseProject } from "../parse/project-parser.js";
import { placeholderBody, placeholderAttr } from "./placeholders.js";
import type { ProjectConfig } from "../config/schema.js";

export interface PaletteResponse {
  components: PaletteEntry[];
  templates: PaletteEntry[];
  typography: TypographySpecimen[];
}

export interface PaletteEntry {
  name: string;
  kind: "component" | "template";
  meta: {
    tag?: string;
    class?: string;
    attrs?: string[];
    params?: string[];
    slots?: string[];
    inline?: boolean;
  };
  renders: Render[];
}

export interface Render {
  label?: string;
  html: string;
  snippet: string;
}

export interface TypographySpecimen {
  id: string;
  label: string;
  html: string;
}

const TYPOGRAPHY: TypographySpecimen[] = [
  { id: "h1", label: "Heading 1", html: "<h1>The quick brown fox</h1>" },
  { id: "h2", label: "Heading 2", html: "<h2>The quick brown fox</h2>" },
  { id: "h3", label: "Heading 3", html: "<h3>The quick brown fox</h3>" },
  { id: "h4", label: "Heading 4", html: "<h4>The quick brown fox</h4>" },
  {
    id: "p", label: "Body paragraph",
    html: "<p>A paragraph with <em>emphasis</em>, <strong>strong</strong>, <code>inline code</code>, and a <a href=\"#\">link</a>. Long enough to wrap to a second line in a typical column width so you can judge leading and rhythm.</p>"
  },
  { id: "ul", label: "Unordered list", html: "<ul><li>First item</li><li>Second item<ul><li>Nested</li></ul></li><li>Third item</li></ul>" },
  { id: "ol", label: "Ordered list", html: "<ol><li>First step</li><li>Second step</li><li>Third step</li></ol>" },
  { id: "blockquote", label: "Blockquote", html: "<blockquote><p>The standard chunk of Lorem Ipsum used since the 1500s is reproduced below for those interested.</p></blockquote>" },
  { id: "pre", label: "Code block", html: "<pre><code>const x = 1;\nconst y = 2;\nconsole.log(x + y);</code></pre>" },
  { id: "hr", label: "Horizontal rule", html: "<hr>" }
];

export async function buildPalette(config: ProjectConfig): Promise<PaletteResponse> {
  const components: PaletteEntry[] = [];
  for (const [name, def] of Object.entries(config.components ?? {})) {
    if (!def) continue;
    components.push(await buildComponentEntry(name, def, config));
  }
  const templates: PaletteEntry[] = [];
  for (const [name, def] of Object.entries(config.templates ?? {})) {
    if (!def) continue;
    templates.push(await buildTemplateEntry(name, def, config));
  }
  return { components, templates, typography: TYPOGRAPHY };
}

async function buildComponentEntry(
  name: string,
  def: NonNullable<ProjectConfig["components"]>[string],
  config: ProjectConfig
): Promise<PaletteEntry> {
  const renders: Render[] = [];
  const baseAttrs = def.palette?.attrs ?? defaultAttrs(def.attrs);
  const baseBody = def.palette?.body ?? placeholderBody(0);
  renders.push({
    label: "default",
    html: await renderComponent(name, baseAttrs, baseBody, config, def.inline),
    snippet: componentSnippet(name, baseAttrs, baseBody, def.inline)
  });
  const variants = def.palette?.variants ?? [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    const attrs = { ...baseAttrs, ...(v.attrs ?? {}) };
    const body = v.body ?? baseBody;
    renders.push({
      label: `variant ${i + 1}`,
      html: await renderComponent(name, attrs, body, config, def.inline),
      snippet: componentSnippet(name, attrs, body, def.inline)
    });
  }
  return {
    name,
    kind: "component",
    meta: { tag: def.tag, class: def.class, attrs: def.attrs, inline: def.inline },
    renders
  };
}

async function buildTemplateEntry(
  name: string,
  def: NonNullable<ProjectConfig["templates"]>[string],
  config: ProjectConfig
): Promise<PaletteEntry> {
  const renders: Render[] = [];
  const baseParams = def.palette?.params ?? defaultParams(def.params);
  const baseBody = def.palette?.body ?? placeholderBody(0);
  const baseSlots = def.palette?.slots ?? defaultSlots(def.slots, 1);
  renders.push({
    label: "default",
    html: await renderTemplate(name, baseParams, baseBody, baseSlots, config),
    snippet: templateSnippet(name, baseParams, baseBody, baseSlots, def.slots)
  });
  for (let i = 0; i < (def.palette?.variants ?? []).length; i++) {
    const v = def.palette!.variants![i]!;
    const params = { ...baseParams, ...(v.params ?? {}) };
    const body = v.body ?? baseBody;
    const slots = { ...baseSlots, ...(v.slots ?? {}) };
    renders.push({
      label: `variant ${i + 1}`,
      html: await renderTemplate(name, params, body, slots, config),
      snippet: templateSnippet(name, params, body, slots, def.slots)
    });
  }
  return {
    name,
    kind: "template",
    meta: { params: def.params, slots: def.slots },
    renders
  };
}

function defaultAttrs(attrs: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of attrs ?? []) out[a] = placeholderAttr(a);
  return out;
}

function defaultParams(params: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of params ?? []) out[p] = placeholderAttr(p);
  return out;
}

function defaultSlots(slots: string[] | undefined, seedBase: number): Record<string, string> {
  const out: Record<string, string> = {};
  let i = seedBase;
  for (const s of slots ?? []) out[s] = placeholderBody(i++);
  return out;
}

async function renderComponent(
  name: string,
  attrs: Record<string, string>,
  body: string,
  config: ProjectConfig,
  inline: boolean | undefined
): Promise<string> {
  if (inline) {
    const attrPart = Object.entries(attrs).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
    const src = attrPart ? `:${name}[${body}]{${attrPart}}` : `:${name}[${body}]`;
    return await parseProject(src, config);
  }
  const attrPart = Object.entries(attrs).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
  const head = attrPart ? `:::${name}{${attrPart}}` : `:::${name}`;
  const src = `${head}\n\n${body}\n\n:::\n`;
  return await parseProject(src, config);
}

async function renderTemplate(
  name: string,
  params: Record<string, string>,
  body: string,
  slots: Record<string, string>,
  config: ProjectConfig
): Promise<string> {
  const paramPart = Object.entries(params).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
  const head = paramPart ? `:::${name}{${paramPart}}` : `:::${name}`;
  const slotEntries = Object.entries(slots);
  const slotBlocks = slotEntries.map(([k, v]) => `--- ${k} ---\n\n${v}`).join("\n\n");
  const innerBody = slotEntries.length > 0 ? slotBlocks : body;
  const src = `${head}\n\n${innerBody}\n\n:::\n`;
  return await parseProject(src, config);
}

function componentSnippet(
  name: string,
  attrs: Record<string, string>,
  body: string,
  inline: boolean | undefined
): string {
  if (inline) {
    const attrPart = Object.entries(attrs).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
    return attrPart ? `:${name}[${body}]{${attrPart}}` : `:${name}[${body}]`;
  }
  const attrPart = Object.entries(attrs).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
  const head = attrPart ? `:::${name}{${attrPart}}` : `:::${name}`;
  return `${head}\n${body}\n:::`;
}

function templateSnippet(
  name: string,
  params: Record<string, string>,
  body: string,
  slots: Record<string, string>,
  declaredSlots: string[] | undefined
): string {
  const paramPart = Object.entries(params).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
  const head = paramPart ? `:::${name}{${paramPart}}` : `:::${name}`;
  if (declaredSlots && declaredSlots.length > 0) {
    const blocks = declaredSlots.map(s => `--- ${s} ---\n${slots[s] ?? ""}`).join("\n");
    return `${head}\n${blocks}\n:::`;
  }
  return `${head}\n${body}\n:::`;
}

function quote(s: string): string {
  if (/^[\w-]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}
```

**Step 4: Run** — PASS.

**Step 5: Update `packages/core/src/index.ts`** to export:

```typescript
export { buildPalette } from "./palette/build-palette.js";
export type { PaletteResponse, PaletteEntry, Render, TypographySpecimen } from "./palette/build-palette.js";
```

**Step 6: Commit**

```
git add packages/core
git commit -m "feat(core): buildPalette returns pre-rendered tiles + typography specimen"
```

### Task 0.4: User-guide markdown renderer

**Files:**
- Create: `packages/core/src/help/render-help.ts`
- Create: `packages/core/src/help/render-help.test.ts`
- Move/copy: bundle a built-in `user-guide.md` for fallback

**Step 1: Failing test**

```typescript
// packages/core/src/help/render-help.test.ts
import { describe, it, expect } from "vitest";
import { renderHelp } from "./render-help.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../test/fixtures");

describe("renderHelp", () => {
  it("renders a project's docs/user-guide.md when present", async () => {
    const result = await renderHelp(join(fixturesDir, "with-user-guide"));
    expect(result.source).toBe("project");
    expect(result.html).toContain("<h1>Project guide</h1>");
  });

  it("falls back to the built-in user guide when project has none", async () => {
    const result = await renderHelp(join(fixturesDir, "hello"));
    expect(result.source).toBe("builtin");
    expect(result.html).toContain("Tender User Guide");
  });
});
```

**Step 2: Create fixtures**

`packages/core/test/fixtures/with-user-guide/project.yaml` (copy from `hello`).

`packages/core/test/fixtures/with-user-guide/docs/user-guide.md`:
```markdown
# Project guide

Project-specific notes for authors.
```

`packages/core/test/fixtures/with-user-guide/styles.css` and `content.md` — copy from `hello`.

**Step 3: Implement**

```typescript
// packages/core/src/help/render-help.ts
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const here = dirname(fileURLToPath(import.meta.url));
const builtinPath = join(here, "../../assets/builtin-user-guide.md");

export interface HelpResponse {
  html: string;
  source: "project" | "builtin";
}

export async function renderHelp(projectDir: string): Promise<HelpResponse> {
  const projectGuide = join(projectDir, "docs", "user-guide.md");
  let source: "project" | "builtin" = "project";
  let raw: string;
  try {
    raw = await readFile(projectGuide, "utf8");
  } catch {
    raw = await readFile(builtinPath, "utf8");
    source = "builtin";
  }
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(raw);
  return { html: String(file), source };
}
```

**Step 4: Bundle the built-in user guide**

```
mkdir -p packages/core/assets
cp docs/user-guide.md packages/core/assets/builtin-user-guide.md
```

Modify `packages/core/package.json` to include `assets/` in published files:
```json
"files": ["dist", "assets"]
```

**Step 5: Run** — PASS.

**Step 6: Commit**

```
git add packages/core
git commit -m "feat(core): renderHelp resolves docs/user-guide.md or built-in fallback"
```

### Task 0.5: Typed WS messages from preview server

**Files:**
- Modify: `packages/cli/src/commands/preview.ts`
- Modify: `packages/cli/src/commands/preview.test.ts`

Today the WS sends a bare `"reload"` string on any change. Switch to typed JSON messages so the SPA can decide what to refetch.

**Step 1: Add a failing test**

In `preview.test.ts`, append:

```typescript
import WebSocket from "ws";
import { writeFile } from "node:fs/promises";

it("sends typed WS messages identifying the changed file kind", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tender-ws-"));
  try {
    // Seed minimal project
    await writeFile(join(tmp, "project.yaml"), `page-templates:\n  default: { size: A5, margin: 0 }\n`);
    await writeFile(join(tmp, "styles.css"), `body{}`);
    await writeFile(join(tmp, "content.md"), `# Hi`);

    const server = await startPreviewServer({ projectDir: tmp, port: 0 });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/_tender`);
      const message = await new Promise<string>((resolve, reject) => {
        ws.on("open", async () => {
          await writeFile(join(tmp, "content.md"), `# Hello again`);
        });
        ws.on("message", (data) => resolve(data.toString()));
        ws.on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 10_000);
      });
      ws.close();
      const parsed = JSON.parse(message);
      expect(parsed.kind).toBe("content");
    } finally {
      await server.close();
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}, 30_000);
```

(Add `mkdtemp`, `tmpdir`, `rm` imports if missing. `ws` is already a dep.)

**Step 2: Run** — FAIL (existing code sends `"reload"`).

**Step 3: Implement**

In `preview.ts`, change the watcher callback:

```typescript
function classifyPath(path: string, projectDir: string): WsMessage["kind"] {
  const rel = path.startsWith(projectDir) ? path.slice(projectDir.length + 1) : path;
  if (rel === "content.md") return "content";
  if (rel === "project.yaml") return "project";
  if (rel === "styles.css") return "styles";
  if (rel === "docs/user-guide.md") return "help";
  if (rel.startsWith("assets/") || rel.startsWith("assets" + sep)) return "assets";
  return "content"; // default fallback
}

type WsMessage =
  | { kind: "content" }
  | { kind: "project" }
  | { kind: "styles" }
  | { kind: "help" }
  | { kind: "assets" }
  | { kind: "error"; message: string };
```

Replace the watcher's `client.send("reload")` with:

```typescript
watcher.on("all", async (_event, path) => {
  try {
    await rebuild();
    const kind = classifyPath(path, opts.projectDir);
    const msg: WsMessage = buildError
      ? { kind: "error", message: buildError.message }
      : { kind };
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  } catch (err) {
    console.error("preview rebuild failed:", err instanceof Error ? err.message : err);
  }
});
```

Don't forget to import `sep` from `node:path` if not already.

**Step 4: Update the inline reload script** in `preview.ts` (`RELOAD_SCRIPT`) so it parses JSON. Until the SPA exists, it should still trigger a reload on any non-error message:

```typescript
const RELOAD_SCRIPT = `<script>
(() => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/_tender');
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.kind !== 'error') location.reload();
    } catch { location.reload(); }
  };
})();
</script>`;
```

**Step 5: Run** — PASS. Verify all existing preview tests still pass.

**Step 6: Commit**

```
git add packages/cli
git commit -m "feat(cli): preview WS sends typed file-kind messages"
```

### Task 0.6: `/_api/palette` endpoint

**Files:**
- Modify: `packages/cli/src/commands/preview.ts`
- Modify: `packages/cli/src/commands/preview.test.ts`

**Step 1: Failing test**

```typescript
it("serves /_api/palette as JSON for projects with components", async () => {
  const server = await startPreviewServer({
    projectDir: join(fixturesDir, "components"),
    port: 0
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/_api/palette`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.components.length).toBeGreaterThan(0);
    expect(body.templates.length).toBeGreaterThan(0);
    expect(body.typography.length).toBeGreaterThan(0);
    expect(body.components[0].name).toBe("callout");
    expect(body.components[0].renders[0].html).toContain("<aside");
  } finally {
    await server.close();
  }
}, 30_000);
```

**Step 2: Run** — FAIL.

**Step 3: Wire up the endpoint**

In `preview.ts`, after the existing `app.use("/assets", ...)`:

```typescript
import { buildPalette, loadProjectConfig } from "@tender/core";

app.get("/_api/palette", async (_req, res, next) => {
  try {
    const config = await loadProjectConfig(opts.projectDir);
    const palette = await buildPalette(config);
    res.json(palette);
  } catch (err) {
    next(err);
  }
});
```

**Step 4: Run** — PASS.

**Step 5: Commit**

```
git add packages/cli
git commit -m "feat(cli): GET /_api/palette returns pre-rendered tile data"
```

### Task 0.7: `/_api/help`, `/_api/styles.css`, `/_api/_project.css`

**Files:**
- Modify: `packages/cli/src/commands/preview.ts`
- Modify: `packages/cli/src/commands/preview.test.ts`

Three small endpoints; one commit.

**Step 1: Failing tests**

```typescript
it("serves /_api/help with HTML and source field", async () => {
  const server = await startPreviewServer({
    projectDir: join(fixturesDir, "hello"),
    port: 0
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/_api/help`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("builtin");
    expect(body.html).toMatch(/<h1[^>]*>/);
  } finally {
    await server.close();
  }
}, 30_000);

it("serves /_api/styles.css and /_api/_project.css", async () => {
  const server = await startPreviewServer({
    projectDir: join(fixturesDir, "hello"),
    port: 0
  });
  try {
    const stylesRes = await fetch(`http://127.0.0.1:${server.port}/_api/styles.css`);
    expect(stylesRes.status).toBe(200);
    expect(stylesRes.headers.get("content-type")).toMatch(/text\/css/);
    expect(await stylesRes.text()).toContain("font-family");

    const projectRes = await fetch(`http://127.0.0.1:${server.port}/_api/_project.css`);
    expect(projectRes.status).toBe(200);
    expect(await projectRes.text()).toContain("@page");
  } finally {
    await server.close();
  }
}, 30_000);
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```typescript
import { renderHelp, buildProject } from "@tender/core";

app.get("/_api/help", async (_req, res, next) => {
  try {
    res.json(await renderHelp(opts.projectDir));
  } catch (err) {
    next(err);
  }
});

app.get("/_api/styles.css", async (_req, res, next) => {
  try {
    const result = await buildProject(opts.projectDir);
    res.type("text/css").send(result.stylesCss);
  } catch (err) {
    next(err);
  }
});

app.get("/_api/_project.css", async (_req, res, next) => {
  try {
    const result = await buildProject(opts.projectDir);
    res.type("text/css").send(result.projectCss);
  } catch (err) {
    next(err);
  }
});
```

**Step 4: Run** — PASS.

**Step 5: Commit**

```
git add packages/cli
git commit -m "feat(cli): /_api/help, /_api/styles.css, /_api/_project.css endpoints"
```

### Task 0.8: Move existing preview from `/` to `/_preview`

**Files:**
- Modify: `packages/cli/src/commands/preview.ts`
- Modify: `packages/cli/src/commands/preview.test.ts`

`/` will become the SPA shell in Phase 2. For now, free up `/` by moving the rendered HTML to `/_preview` and have `/` serve a small placeholder page that just embeds `/_preview` (so existing user behavior is preserved until Phase 2 lands).

**Step 1: Update tests**

In `preview.test.ts`:

- Change the existing `serves rendered HTML at /` test to expect `/_preview`:

```typescript
it("serves rendered HTML at /_preview", async () => {
  const server = await startPreviewServer({
    projectDir: join(fixturesDir, "hello"),
    port: 0
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/_preview`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Hello, Tender");
  } finally {
    await server.close();
  }
}, 60_000);

it("serves a placeholder shell at / that embeds /_preview", async () => {
  const server = await startPreviewServer({
    projectDir: join(fixturesDir, "hello"),
    port: 0
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Phase 0 placeholder: a tiny HTML page with an iframe to /_preview
    expect(html).toContain("/_preview");
  } finally {
    await server.close();
  }
}, 30_000);
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

In `preview.ts`, change the route handlers:

```typescript
app.get("/_preview", async (_req, res) => {
  res.type("html").send(cachedHtml ?? "");
});

app.get("/", async (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Tender Preview</title>
<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style>
</head><body><iframe src="/_preview"></iframe></body></html>`);
});
```

**Step 4: Run** — PASS.

**Step 5: Manual smoke**

```
pnpm -r build
node packages/cli/dist/cli.js preview packages/core/test/fixtures/coastal-planet --port 0
```

Visit the printed URL — same content as before, just nested in an iframe.

**Step 6: Commit**

```
git add packages/cli
git commit -m "refactor(cli): move rendered preview to /_preview; / serves shell"
```

**End of Phase 0:** All API endpoints exist and tested. WS messages are typed. The shell at `/` is a placeholder iframe; Phase 2 will replace it with the real SPA.

---

## Phase 1 — `@tender/preview-ui` package skeleton

End of phase: empty Solid+Vite SPA builds and the CLI can serve its bundle.

### Task 1.1: Scaffold `@tender/preview-ui` with Solid + Vite

**Files:**
- Create: `packages/preview-ui/package.json`
- Create: `packages/preview-ui/tsconfig.json`
- Create: `packages/preview-ui/vite.config.ts`
- Create: `packages/preview-ui/index.html`
- Create: `packages/preview-ui/src/main.tsx`
- Create: `packages/preview-ui/src/App.tsx`
- Create: `packages/preview-ui/src/styles.css`

**Step 1: Add deps from the workspace root**

```
pnpm --filter @tender/preview-ui add solid-js @solidjs/router
pnpm --filter @tender/preview-ui add -D vite vite-plugin-solid typescript
```

(If pnpm complains the package doesn't exist yet, create the package directory and `package.json` first, then run install.)

**Step 2: `packages/preview-ui/package.json`**

```json
{
  "name": "@tender/preview-ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "solid-js": "^1.8.0",
    "@solidjs/router": "^0.15.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vite-plugin-solid": "^2.10.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**Step 3: `packages/preview-ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "noEmit": true,
    "verbatimModuleSyntax": false,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "vite.config.ts"]
}
```

(Note: this package overrides `module`/`moduleResolution` because Vite uses Bundler resolution, unlike the Node packages. `verbatimModuleSyntax` off because `solid-js`'s JSX factory is implicit.)

**Step 4: `packages/preview-ui/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  base: "/_ui/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  server: {
    proxy: {
      "/_api": "http://127.0.0.1:3993",
      "/_preview": "http://127.0.0.1:3993",
      "/_tender": { target: "ws://127.0.0.1:3993", ws: true }
    }
  }
});
```

**Step 5: `packages/preview-ui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Tender Preview</title>
    <link rel="stylesheet" href="/_ui/assets/main.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: `packages/preview-ui/src/main.tsx`**

```tsx
/* @refresh reload */
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
render(() => <App />, root);
```

**Step 7: `packages/preview-ui/src/App.tsx`**

```tsx
export function App() {
  return <div>Tender preview UI — Phase 1 scaffold</div>;
}
```

**Step 8: `packages/preview-ui/src/styles.css`**

```css
:root { font-family: system-ui, sans-serif; }
body { margin: 0; }
```

**Step 9: Build**

```
pnpm install
pnpm --filter @tender/preview-ui build
ls packages/preview-ui/dist/
ls packages/preview-ui/dist/assets/
```

Expected: `index.html` and an `assets/` directory with the bundled JS.

**Step 10: Commit**

```
git add packages/preview-ui pnpm-lock.yaml
git commit -m "feat(preview-ui): scaffold Solid+Vite package"
```

### Task 1.2: Serve preview-ui bundle from CLI

**Files:**
- Modify: `packages/cli/package.json` (add dep + build chaining)
- Modify: `packages/cli/src/commands/preview.ts`
- Modify: `packages/cli/src/commands/preview.test.ts`

**Step 1: Add dep**

```
pnpm --filter @tender/cli add @tender/preview-ui
```

(Workspace dep; pnpm will use `workspace:*`.)

**Step 2: Failing test**

In `preview.test.ts`:

```typescript
it("serves the preview-ui shell HTML at /", async () => {
  const server = await startPreviewServer({
    projectDir: join(fixturesDir, "hello"),
    port: 0
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<div id=\"root\">");
    expect(html).toMatch(/_ui\/assets\//);
  } finally {
    await server.close();
  }
}, 30_000);

it("serves preview-ui bundle assets under /_ui/", async () => {
  const server = await startPreviewServer({
    projectDir: join(fixturesDir, "hello"),
    port: 0
  });
  try {
    // Fetch the shell, parse the script src
    const shellHtml = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    const scriptMatch = shellHtml.match(/src="(\/_ui\/assets\/[^"]+\.js)"/);
    expect(scriptMatch).not.toBeNull();
    const scriptRes = await fetch(`http://127.0.0.1:${server.port}${scriptMatch![1]}`);
    expect(scriptRes.status).toBe(200);
    expect(scriptRes.headers.get("content-type")).toMatch(/javascript/);
  } finally {
    await server.close();
  }
}, 30_000);
```

**Step 3: Run** — FAIL.

**Step 4: Implement**

In `preview.ts`, replace the placeholder `/` handler from Task 0.8 with:

```typescript
import { fileURLToPath } from "node:url";
import express from "express";

const previewUiDist = (() => {
  // Resolve @tender/preview-ui's dist directory
  // The package's main field doesn't matter; we want its dist/index.html
  const pkg = createRequire(import.meta.url).resolve("@tender/preview-ui/package.json");
  return join(dirname(pkg), "dist");
})();

// Serve bundle assets
app.use("/_ui", express.static(join(previewUiDist, "assets")));

// Shell at /
app.get("/", async (_req, res, next) => {
  try {
    const shell = await readFile(join(previewUiDist, "index.html"), "utf8");
    res.type("html").send(shell);
  } catch (err) {
    next(err);
  }
});
```

(Add `createRequire`, `dirname`, `readFile` imports.)

The `index.html` produced by Vite references `assets/main-XXXX.js` etc.; with `base: "/_ui/"` those become `/_ui/assets/main-XXXX.js`. The static handler covers them.

**Step 5: Build everything in dependency order and run**

```
pnpm -r build
pnpm --filter @tender/cli test
```

Expected: tests pass.

**Step 6: Commit**

```
git add packages/cli
git commit -m "feat(cli): serve preview-ui shell at / and bundle under /_ui/"
```

### Task 1.3: API client and WS hook in preview-ui

**Files:**
- Create: `packages/preview-ui/src/api.ts`
- Create: `packages/preview-ui/src/api.test.ts`

A small typed client. No actual server in tests — we mock `fetch` and `WebSocket`.

**Step 1: Add testing deps**

```
pnpm --filter @tender/preview-ui add -D jsdom @solidjs/testing-library @testing-library/jest-dom
```

Add a `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true
  }
});
```

**Step 2: Failing test**

```typescript
// packages/preview-ui/src/api.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchPalette, fetchHelp } from "./api.ts";

describe("api client", () => {
  it("fetchPalette parses JSON from /_api/palette", async () => {
    const fakeResponse = { components: [], templates: [], typography: [] };
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }))
    ));
    const result = await fetchPalette();
    expect(result.components).toEqual([]);
  });

  it("fetchHelp returns html and source", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ html: "<p>ok</p>", source: "builtin" }), { status: 200 }))
    ));
    const result = await fetchHelp();
    expect(result.source).toBe("builtin");
  });
});
```

**Step 3: Run** — FAIL.

**Step 4: Implement**

```typescript
// packages/preview-ui/src/api.ts
export interface PaletteEntry {
  name: string;
  kind: "component" | "template";
  meta: {
    tag?: string;
    class?: string;
    attrs?: string[];
    params?: string[];
    slots?: string[];
    inline?: boolean;
  };
  renders: { label?: string; html: string; snippet: string }[];
}

export interface TypographySpecimen {
  id: string;
  label: string;
  html: string;
}

export interface PaletteResponse {
  components: PaletteEntry[];
  templates: PaletteEntry[];
  typography: TypographySpecimen[];
}

export interface HelpResponse {
  html: string;
  source: "project" | "builtin";
}

export type WsMessage =
  | { kind: "content" }
  | { kind: "project" }
  | { kind: "styles" }
  | { kind: "help" }
  | { kind: "assets" }
  | { kind: "error"; message: string };

export async function fetchPalette(): Promise<PaletteResponse> {
  const res = await fetch("/_api/palette");
  if (!res.ok) throw new Error(`palette fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchHelp(): Promise<HelpResponse> {
  const res = await fetch("/_api/help");
  if (!res.ok) throw new Error(`help fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchStylesCss(): Promise<string> {
  const res = await fetch("/_api/styles.css");
  if (!res.ok) throw new Error(`styles.css fetch failed: ${res.status}`);
  return res.text();
}

export async function fetchProjectCss(): Promise<string> {
  const res = await fetch("/_api/_project.css");
  if (!res.ok) throw new Error(`_project.css fetch failed: ${res.status}`);
  return res.text();
}

export function connectReloadSocket(onMessage: (msg: WsMessage) => void): () => void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(`${proto}//${location.host}/_tender`);
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data) as WsMessage); }
      catch { /* ignore malformed */ }
    };
    ws.onclose = () => {
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 5000);
    };
  };

  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
```

**Step 5: Run** — PASS.

**Step 6: Commit**

```
git add packages/preview-ui pnpm-lock.yaml
git commit -m "feat(preview-ui): typed API client and reload socket"
```

**End of Phase 1:** SPA package builds, CLI serves it, API client compiles. Visiting `/` shows the placeholder text from `App.tsx`.

---

## Phase 2 — Tab shell + Preview tab

End of phase: tabs visible at `/`, `/palette`, `/help`. Preview tab shows the existing rendered output via iframe. Other tabs are placeholders.

### Task 2.1: Top tab bar component with router

**Files:**
- Modify: `packages/preview-ui/src/App.tsx`
- Create: `packages/preview-ui/src/components/TabBar.tsx`
- Create: `packages/preview-ui/src/components/TabBar.test.tsx`

**Step 1: Failing test**

```tsx
// packages/preview-ui/src/components/TabBar.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { Router } from "@solidjs/router";
import { TabBar } from "./TabBar.tsx";

describe("TabBar", () => {
  it("renders Preview, Palette, and Help links", () => {
    const { getByText } = render(() => (
      <Router>
        <TabBar />
      </Router>
    ));
    expect(getByText("Preview")).toBeTruthy();
    expect(getByText("Palette")).toBeTruthy();
    expect(getByText("Help")).toBeTruthy();
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```tsx
// packages/preview-ui/src/components/TabBar.tsx
import { A } from "@solidjs/router";
import "./TabBar.css";

export function TabBar() {
  return (
    <nav class="tabbar">
      <A href="/" end class="tab">Preview</A>
      <A href="/palette" class="tab">Palette</A>
      <A href="/help" class="tab">Help</A>
    </nav>
  );
}
```

`packages/preview-ui/src/components/TabBar.css`:

```css
.tabbar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #ccc;
  background: #f6f6f6;
  padding: 0 12px;
}
.tab {
  padding: 10px 16px;
  text-decoration: none;
  color: #333;
  border-bottom: 2px solid transparent;
  font: 14px system-ui, sans-serif;
}
.tab.active {
  border-bottom-color: #1a1a1a;
  font-weight: 600;
}
```

(Solid Router's `<A>` adds `aria-current="page"` to the active link by default; `.tab[aria-current="page"]` is the better selector. Adjust:)

```css
.tab[aria-current="page"] {
  border-bottom-color: #1a1a1a;
  font-weight: 600;
}
```

**Step 4: Update `App.tsx`**

```tsx
import { Router, Route } from "@solidjs/router";
import { TabBar } from "./components/TabBar.tsx";
import { Preview } from "./tabs/Preview.tsx";
import { Palette } from "./tabs/Palette.tsx";
import { Help } from "./tabs/Help.tsx";
import "./App.css";

const Layout = (props: { children: any }) => (
  <div class="app">
    <TabBar />
    <main class="content">{props.children}</main>
  </div>
);

export function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Preview} />
      <Route path="/palette" component={Palette} />
      <Route path="/help" component={Help} />
    </Router>
  );
}
```

`App.css`:

```css
.app { display: flex; flex-direction: column; height: 100vh; }
.content { flex: 1; overflow: hidden; }
```

**Step 5: Stub the three tabs**

```tsx
// packages/preview-ui/src/tabs/Preview.tsx
export function Preview() { return <div>preview tab</div>; }

// packages/preview-ui/src/tabs/Palette.tsx
export function Palette() { return <div>palette tab</div>; }

// packages/preview-ui/src/tabs/Help.tsx
export function Help() { return <div>help tab</div>; }
```

**Step 6: Run** — PASS. Build + smoke:

```
pnpm -r build
node packages/cli/dist/cli.js preview packages/core/test/fixtures/coastal-planet --port 0
```

Visit the URL, verify tabs are visible and clicking them changes route.

**Step 7: Commit**

```
git add packages/preview-ui
git commit -m "feat(preview-ui): tab bar and routing"
```

### Task 2.2: Preview tab — embed iframe with persistent mount

**Files:**
- Modify: `packages/preview-ui/src/tabs/Preview.tsx`
- Create: `packages/preview-ui/src/tabs/Preview.test.tsx`
- Modify: `packages/preview-ui/src/App.tsx` (mount the iframe at the layout level so it's persistent across tab switches)

The Preview iframe must NOT unmount when switching tabs — re-mounting forces Paged.js to re-render, costing seconds. Instead, mount it permanently in the layout and toggle visibility.

**Step 1: Refactor App.tsx to keep the iframe persistent**

```tsx
// App.tsx
import { Router, Route, useLocation } from "@solidjs/router";
import { Show, createMemo } from "solid-js";
import { TabBar } from "./components/TabBar.tsx";
import { PreviewIframe } from "./tabs/Preview.tsx";
import { Palette } from "./tabs/Palette.tsx";
import { Help } from "./tabs/Help.tsx";
import { connectReloadSocket } from "./api.ts";
import { onCleanup } from "solid-js";
import "./App.css";

const Layout = (props: { children: any }) => {
  const location = useLocation();
  const isPreview = createMemo(() => location.pathname === "/");

  // The iframe is mounted permanently; only its visibility toggles.
  // The route's `Preview` component renders an empty placeholder; the real
  // iframe lives in the layout so it survives tab switches.
  return (
    <div class="app">
      <TabBar />
      <main class="content">
        <PreviewIframe visible={isPreview()} />
        <div class="tab-content" classList={{ hidden: isPreview() }}>
          {props.children}
        </div>
      </main>
    </div>
  );
};

export function App() {
  // Start the reload socket once; later tasks will dispatch to interested tabs.
  const close = connectReloadSocket((msg) => {
    if (msg.kind === "content" || msg.kind === "project" || msg.kind === "styles" || msg.kind === "assets") {
      const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
      iframe?.contentWindow?.location.reload();
    }
  });
  onCleanup(close);

  return (
    <Router root={Layout}>
      <Route path="/" component={() => null} />
      <Route path="/palette" component={Palette} />
      <Route path="/help" component={Help} />
    </Router>
  );
}
```

Add to `App.css`:

```css
.tab-content { height: 100%; overflow: auto; }
.tab-content.hidden { display: none; }
```

**Step 2: Implement `PreviewIframe`**

```tsx
// packages/preview-ui/src/tabs/Preview.tsx
import "./Preview.css";

export function PreviewIframe(props: { visible: boolean }) {
  return (
    <iframe
      id="preview-iframe"
      src="/_preview"
      class="preview-iframe"
      classList={{ hidden: !props.visible }}
      title="Preview"
    />
  );
}
```

`Preview.css`:

```css
.preview-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.preview-iframe.hidden { display: none; }
```

**Step 3: Test**

```tsx
// packages/preview-ui/src/tabs/Preview.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PreviewIframe } from "./Preview.tsx";

describe("PreviewIframe", () => {
  it("renders an iframe pointing at /_preview", () => {
    const { container } = render(() => <PreviewIframe visible={true} />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.src).toMatch(/\/_preview$/);
  });

  it("hides the iframe when not visible", () => {
    const { container } = render(() => <PreviewIframe visible={false} />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.classList.contains("hidden")).toBe(true);
  });
});
```

**Step 4: Run** — PASS.

**Step 5: Smoke**

```
pnpm -r build
node packages/cli/dist/cli.js preview packages/core/test/fixtures/coastal-planet --port 0
```

Verify: Preview tab shows the rendered pages; clicking Palette/Help hides the preview but doesn't destroy it (iframe still exists in DOM); clicking Preview again shows it instantly with no re-render delay.

**Step 6: Commit**

```
git add packages/preview-ui
git commit -m "feat(preview-ui): persistent preview iframe with tab visibility"
```

**End of Phase 2:** Tabs work, Preview tab shows the real rendered output, switching tabs is instant. Palette and Help are placeholders.

---

## Phase 3 — Palette tab

End of phase: Palette tab fetches `/_api/palette`, renders tiles per component/template, applies project CSS via Shadow DOM, shows variants and copy-snippet.

### Task 3.1: `Tile` component with Shadow DOM isolation

**Files:**
- Create: `packages/preview-ui/src/components/Tile.tsx`
- Create: `packages/preview-ui/src/components/Tile.test.tsx`
- Create: `packages/preview-ui/src/components/Tile.css`

**Step 1: Failing test**

```tsx
// packages/preview-ui/src/components/Tile.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { Tile } from "./Tile.tsx";

describe("Tile", () => {
  it("renders title, snippet, and shadow root with HTML", async () => {
    const { container, getByText } = render(() => (
      <Tile
        title="callout"
        meta={{ tag: "aside", class: "callout" }}
        renders={[{ label: "default", html: '<aside class="callout">Hello</aside>', snippet: ":::callout\nHello\n:::" }]}
        css=""
      />
    ));
    expect(getByText("callout")).toBeTruthy();
    expect(container.textContent).toContain(":::callout");
    const host = container.querySelector(".tile-render-host") as HTMLElement;
    expect(host).toBeTruthy();
    expect(host.shadowRoot).toBeTruthy();
    expect(host.shadowRoot!.textContent).toContain("Hello");
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```tsx
// packages/preview-ui/src/components/Tile.tsx
import { For, createEffect } from "solid-js";
import "./Tile.css";

export interface TileProps {
  title: string;
  meta: { tag?: string; class?: string; attrs?: string[]; params?: string[]; slots?: string[]; inline?: boolean };
  renders: { label?: string; html: string; snippet: string }[];
  css: string;
}

export function Tile(props: TileProps) {
  return (
    <article class="tile">
      <header class="tile-header">
        <h3 class="tile-name">{props.title}</h3>
        <dl class="tile-meta">
          {props.meta.tag ? <><dt>tag</dt><dd>{props.meta.tag}</dd></> : null}
          {props.meta.class ? <><dt>class</dt><dd>{props.meta.class}</dd></> : null}
          {props.meta.attrs?.length ? <><dt>attrs</dt><dd>{props.meta.attrs.join(", ")}</dd></> : null}
          {props.meta.params?.length ? <><dt>params</dt><dd>{props.meta.params.join(", ")}</dd></> : null}
          {props.meta.slots?.length ? <><dt>slots</dt><dd>{props.meta.slots.join(", ")}</dd></> : null}
        </dl>
      </header>
      <div class="tile-renders">
        <For each={props.renders}>
          {(r) => <RenderRow html={r.html} label={r.label} css={props.css} />}
        </For>
      </div>
      <footer class="tile-footer">
        <For each={props.renders}>
          {(r) => (
            <div class="snippet">
              {r.label ? <span class="snippet-label">{r.label}</span> : null}
              <pre><code>{r.snippet}</code></pre>
              <button onClick={() => navigator.clipboard.writeText(r.snippet)}>Copy</button>
            </div>
          )}
        </For>
      </footer>
    </article>
  );
}

function RenderRow(props: { html: string; label?: string; css: string }) {
  let hostEl: HTMLDivElement | undefined;
  createEffect(() => {
    if (!hostEl) return;
    let root = hostEl.shadowRoot;
    if (!root) root = hostEl.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${props.css}</style>${props.html}`;
  });
  return (
    <div class="tile-render-row">
      {props.label ? <span class="tile-render-label">{props.label}</span> : null}
      <div class="tile-render-host" ref={hostEl} />
    </div>
  );
}
```

`Tile.css`:

```css
.tile {
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  margin-bottom: 24px;
  overflow: hidden;
}
.tile-header {
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
}
.tile-name { margin: 0; font: 600 14pt system-ui, sans-serif; }
.tile-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 6px 0 0;
  font: 11pt system-ui, sans-serif;
  color: #666;
}
.tile-meta dt { font-weight: 600; }
.tile-meta dd { margin: 0; }
.tile-renders { padding: 14px; }
.tile-render-row { margin-bottom: 12px; }
.tile-render-row:last-child { margin-bottom: 0; }
.tile-render-label {
  display: block;
  font: 600 10pt system-ui, sans-serif;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.tile-render-host {
  border: 1px dashed #eee;
  padding: 12px;
  background: white;
}
.tile-footer { padding: 10px 14px; border-top: 1px solid #eee; background: #fafbfc; }
.snippet { display: flex; align-items: start; gap: 12px; margin-bottom: 8px; }
.snippet:last-child { margin-bottom: 0; }
.snippet-label { font: 600 10pt monospace; color: #888; min-width: 80px; }
.snippet pre { flex: 1; margin: 0; font: 11pt monospace; white-space: pre-wrap; }
.snippet button { padding: 4px 10px; }
```

**Step 4: Run** — PASS.

**Step 5: Commit**

```
git add packages/preview-ui
git commit -m "feat(preview-ui): Tile component with Shadow DOM isolation"
```

### Task 3.2: Palette tab — fetch and render tiles

**Files:**
- Modify: `packages/preview-ui/src/tabs/Palette.tsx`
- Create: `packages/preview-ui/src/tabs/Palette.test.tsx`

**Step 1: Failing test**

```tsx
// packages/preview-ui/src/tabs/Palette.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";
import { Palette } from "./Palette.tsx";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/_api/palette") {
      return Promise.resolve(new Response(JSON.stringify({
        components: [
          { name: "callout", kind: "component", meta: { tag: "aside", class: "callout" },
            renders: [{ label: "default", html: '<aside>Hi</aside>', snippet: ":::callout\nHi\n:::" }] }
        ],
        templates: [],
        typography: [
          { id: "h1", label: "Heading 1", html: "<h1>Hello</h1>" }
        ]
      }), { status: 200 }));
    }
    if (url === "/_api/styles.css") {
      return Promise.resolve(new Response("body { font: serif; }", { status: 200 }));
    }
    if (url === "/_api/_project.css") {
      return Promise.resolve(new Response("@page { size: A5; }", { status: 200 }));
    }
    return Promise.reject(new Error("unexpected " + url));
  }));
});

describe("Palette", () => {
  it("fetches and renders component tiles", async () => {
    const { findByText } = render(() => <Palette />);
    expect(await findByText("callout")).toBeTruthy();
  });

  it("renders typography specimen", async () => {
    const { findByText } = render(() => <Palette />);
    expect(await findByText("Heading 1")).toBeTruthy();
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```tsx
// packages/preview-ui/src/tabs/Palette.tsx
import { createResource, For, Show } from "solid-js";
import { fetchPalette, fetchStylesCss, fetchProjectCss } from "../api.ts";
import { Tile } from "../components/Tile.tsx";
import "./Palette.css";

async function loadAll() {
  const [palette, stylesCss, projectCss] = await Promise.all([
    fetchPalette(),
    fetchStylesCss(),
    fetchProjectCss()
  ]);
  return { palette, css: projectCss + "\n" + stylesCss };
}

export function Palette() {
  const [data] = createResource(loadAll);

  return (
    <div class="palette">
      <Show when={data()} fallback={<div class="palette-loading">Loading…</div>}>
        {(d) => (
          <>
            <Show when={d().palette.components.length > 0}>
              <h2 class="palette-section">Components</h2>
              <For each={d().palette.components}>
                {(c) => <Tile title={c.name} meta={c.meta} renders={c.renders} css={d().css} />}
              </For>
            </Show>
            <Show when={d().palette.templates.length > 0}>
              <h2 class="palette-section">Templates</h2>
              <For each={d().palette.templates}>
                {(t) => <Tile title={t.name} meta={t.meta} renders={t.renders} css={d().css} />}
              </For>
            </Show>
            <h2 class="palette-section">Typography specimen</h2>
            <For each={d().palette.typography}>
              {(t) => <Tile title={t.label} meta={{}} renders={[{ html: t.html, snippet: "" }]} css={d().css} />}
            </For>
          </>
        )}
      </Show>
    </div>
  );
}
```

`Palette.css`:

```css
.palette { padding: 20px; max-width: 900px; margin: 0 auto; }
.palette-section {
  font: 700 18pt system-ui, sans-serif;
  margin: 28px 0 14px;
  border-bottom: 1px solid #ddd;
  padding-bottom: 6px;
}
.palette-section:first-child { margin-top: 0; }
.palette-loading { padding: 40px; text-align: center; color: #888; }
```

**Step 4: Run** — PASS.

**Step 5: Commit**

```
git add packages/preview-ui
git commit -m "feat(preview-ui): Palette tab fetches and renders tiles"
```

### Task 3.3: Hoist `@font-face` rules to document head

**Files:**
- Modify: `packages/preview-ui/src/tabs/Palette.tsx`
- Add: a small util for parsing `@font-face` blocks

The Shadow DOM isolation prevents `@font-face` rules declared inside it from registering globally; fonts won't load. Parse `@font-face` rules out of the project CSS and inject them into the document head once.

**Step 1: Failing test**

```tsx
// add to Palette.test.tsx
it("hoists @font-face rules to document head", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/_api/palette") {
      return Promise.resolve(new Response(JSON.stringify({ components: [], templates: [], typography: [] }), { status: 200 }));
    }
    if (url === "/_api/styles.css") {
      return Promise.resolve(new Response(`@font-face { font-family: 'X'; src: url('x.woff2') format('woff2'); }\nbody { font-family: 'X'; }`, { status: 200 }));
    }
    if (url === "/_api/_project.css") {
      return Promise.resolve(new Response("", { status: 200 }));
    }
    return Promise.reject(new Error("unexpected " + url));
  }));
  render(() => <Palette />);
  await waitFor(() => {
    const styles = Array.from(document.head.querySelectorAll("style[data-tender-fonts]"));
    expect(styles.some(s => s.textContent?.includes("@font-face"))).toBe(true);
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```typescript
// packages/preview-ui/src/util/fonts.ts
export function extractFontFaces(css: string): string {
  // Match @font-face { ... } blocks (handles nested braces shallowly).
  const out: string[] = [];
  const re = /@font-face\s*\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push(m[0]);
  return out.join("\n");
}

export function hoistFontFaces(css: string): void {
  const faces = extractFontFaces(css);
  if (!faces) return;
  let style = document.head.querySelector<HTMLStyleElement>("style[data-tender-fonts]");
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-tender-fonts", "");
    document.head.appendChild(style);
  }
  style.textContent = faces;
}
```

In `Palette.tsx`, call `hoistFontFaces(d().css)` once after the resource resolves:

```tsx
import { createEffect } from "solid-js";
import { hoistFontFaces } from "../util/fonts.ts";

// inside Palette component:
createEffect(() => {
  const d = data();
  if (d) hoistFontFaces(d.css);
});
```

**Step 4: Run** — PASS.

**Step 5: Commit**

```
git add packages/preview-ui
git commit -m "feat(preview-ui): hoist @font-face from project CSS to document head"
```

### Task 3.4: Selective WS-driven reload

**Files:**
- Modify: `packages/preview-ui/src/App.tsx`
- Modify: `packages/preview-ui/src/tabs/Palette.tsx`

Wire the WS message types from Phase 0 into per-tab refetches.

**Step 1: Failing test (App-level WS dispatch)**

```tsx
// packages/preview-ui/src/App.test.tsx (new file)
// Skip this test — App-level WS dispatch is hard to unit-test without a real server.
// Cover with the integration test in Phase 4 instead.
```

(No failing test for this task; it's cross-cutting glue. Verify by manual smoke + the Phase 4 integration test.)

**Step 2: Implement Palette refetch on WS**

Pass a "refresh signal" from `App` into `Palette`. Simplest: a context provider with a "version" number that increments on relevant WS events.

In `App.tsx`:

```tsx
import { createSignal, createContext, useContext } from "solid-js";

const ReloadContext = createContext<{ version: () => number }>();

export function useReloadVersion() {
  return useContext(ReloadContext)!;
}

// Inside App:
const [paletteVersion, setPaletteVersion] = createSignal(0);
const [helpVersion, setHelpVersion] = createSignal(0);
const close = connectReloadSocket((msg) => {
  if (msg.kind === "content" || msg.kind === "project" || msg.kind === "styles" || msg.kind === "assets") {
    document.getElementById("preview-iframe")?.dispatchEvent(new Event("tender-reload"));
    const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
    iframe?.contentWindow?.location.reload();
  }
  if (msg.kind === "project" || msg.kind === "styles") {
    setPaletteVersion(v => v + 1);
  }
  if (msg.kind === "help") {
    setHelpVersion(v => v + 1);
  }
});

return (
  <ReloadContext.Provider value={{ version: paletteVersion }}>
    {/* router as before */}
  </ReloadContext.Provider>
);
```

(Plus a separate context for `helpVersion` — or combine into one with a discriminated payload.)

In `Palette.tsx`, key `createResource` on the version:

```tsx
const reload = useReloadVersion();
const [data] = createResource(reload.version, loadAll);
```

This re-runs `loadAll` whenever `paletteVersion` changes.

**Step 3: Manual smoke**

```
pnpm -r build
node packages/cli/dist/cli.js preview packages/core/test/fixtures/coastal-planet --port 0
```

Visit Palette tab. In another terminal, edit `packages/core/test/fixtures/coastal-planet/styles.css` (e.g., change a color). The Palette tab should re-render tiles with the new style without reloading the whole page.

**Step 4: Commit**

```
git add packages/preview-ui
git commit -m "feat(preview-ui): selective WS-driven reload for Palette"
```

**End of Phase 3:** Palette tab is fully functional with live reload.

---

## Phase 4 — Help tab + integration test

### Task 4.1: Help tab rendering

**Files:**
- Modify: `packages/preview-ui/src/tabs/Help.tsx`
- Create: `packages/preview-ui/src/tabs/Help.test.tsx`

**Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";
import { Help } from "./Help.tsx";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({
      html: "<h1>User Guide</h1><p>Welcome.</p>",
      source: "builtin"
    }), { status: 200 }))
  ));
});

describe("Help", () => {
  it("renders fetched HTML", async () => {
    const { findByText } = render(() => <Help />);
    expect(await findByText("User Guide")).toBeTruthy();
  });

  it("shows 'using built-in' notice when source is builtin", async () => {
    const { findByText } = render(() => <Help />);
    expect(await findByText(/built-in user guide/i)).toBeTruthy();
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement**

```tsx
// packages/preview-ui/src/tabs/Help.tsx
import { createResource, Show } from "solid-js";
import { fetchHelp } from "../api.ts";
import "./Help.css";

export function Help() {
  const [data] = createResource(fetchHelp);
  return (
    <div class="help">
      <Show when={data()} fallback={<div class="help-loading">Loading…</div>}>
        {(d) => (
          <>
            {d().source === "builtin" ? (
              <div class="help-notice">
                Using the built-in user guide. Place a customised copy at <code>docs/user-guide.md</code> in your project to override.
              </div>
            ) : null}
            <article class="help-content" innerHTML={d().html} />
          </>
        )}
      </Show>
    </div>
  );
}
```

`Help.css`:

```css
.help { padding: 24px; max-width: 800px; margin: 0 auto; }
.help-notice {
  padding: 10px 14px;
  background: #fffceb;
  border: 1px solid #f0d870;
  border-radius: 4px;
  font: 11pt system-ui, sans-serif;
  margin-bottom: 24px;
}
.help-content h1 { font: 700 22pt system-ui, sans-serif; margin: 0 0 12px; }
.help-content h2 { font: 600 16pt system-ui, sans-serif; margin: 24px 0 8px; }
.help-content h3 { font: 600 13pt system-ui, sans-serif; margin: 18px 0 6px; }
.help-content p, .help-content ul, .help-content ol { font: 11pt system-ui, sans-serif; line-height: 1.55; }
.help-content code { font: 10pt monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 2px; }
.help-content pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
.help-content pre code { background: none; padding: 0; }
.help-content a { color: #0366d6; }
.help-content table { border-collapse: collapse; }
.help-content th, .help-content td { border: 1px solid #ddd; padding: 6px 10px; }
```

**Step 4: Run** — PASS.

**Step 5: Wire help WS reload**

In `App.tsx`, add `useReloadVersion`-style for help and key the `Help` resource on it (analogous to Task 3.4).

**Step 6: Commit**

```
git add packages/preview-ui
git commit -m "feat(preview-ui): Help tab renders user guide with built-in fallback"
```

### Task 4.2: End-to-end smoke test

**Files:**
- Create: `packages/cli/src/commands/preview.e2e.test.ts`
- Modify: `packages/cli/package.json` (add Puppeteer dev dep — already present transitively via `@tender/render`, but verify)

**Step 1: Failing test**

```typescript
// packages/cli/src/commands/preview.e2e.test.ts
import { describe, it, expect } from "vitest";
import puppeteer from "puppeteer";
import { startPreviewServer } from "./preview.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "../../../core/test/fixtures/coastal-planet");

describe("preview e2e", () => {
  it("loads all three tabs", async () => {
    const server = await startPreviewServer({ projectDir: fixture, port: 0 });
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: "networkidle0", timeout: 60_000 });

      // Preview tab default
      const previewIframe = await page.$("#preview-iframe");
      expect(previewIframe).not.toBeNull();

      // Switch to Palette
      await page.click('a[href="/palette"]');
      await page.waitForFunction(() => document.querySelectorAll(".tile").length > 0, { timeout: 10_000 });

      // Switch to Help
      await page.click('a[href="/help"]');
      await page.waitForFunction(() => document.querySelector(".help-content") !== null, { timeout: 10_000 });
    } finally {
      await browser.close();
      await server.close();
    }
  }, 120_000);
});
```

**Step 2: Run** — should PASS (Phase 0–4 implementation should suffice).

```
pnpm -r build
pnpm --filter @tender/cli test src/commands/preview.e2e.test.ts
```

If anything fails, this is where to fix integration glitches before declaring victory.

**Step 3: Commit**

```
git add packages/cli
git commit -m "test(cli): e2e smoke for preview multi-tab UI"
```

**End of Phase 4:** All tabs work, e2e verified, live reload tested.

---

## Phase 5 — Polish + docs

### Task 5.1: Update README + user guide

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.md`

Add a section to the user guide describing the `palette` block in `project.yaml`. Add a short note in README about the new tabbed UI.

**Step 1: User guide additions**

In `docs/user-guide.md`, in the `project.yaml` reference section, add to the components and templates sub-sections:

```markdown
**`palette` block (optional)** — overrides for the Palette tab in `tender preview`.

| Field | Notes |
|---|---|
| `attrs` / `params` | Object of attribute/param values for the default render. |
| `body` | Body content for the default render. |
| `slots` | Object of slot contents (for templates with named slots). |
| `variants` | List of variant objects (each can override any of the above), shown as additional renders in the tile. |

The `palette` block never affects PDF/HTML output — it's only used for the Palette tab's example tiles.
```

**Step 2: README**

Add a "Preview UI" section between "Quick start" and "Project structure":

```markdown
## Preview UI

`tender preview` opens a tabbed UI:

- **Preview** — the live-reloading rendered output (same as before).
- **Palette** — gallery of components, templates, and typography in this project, each rendered with project styles.
- **Help** — the user guide.

All three update automatically when you edit project files.
```

**Step 3: Commit**

```
git add README.md docs/user-guide.md
git commit -m "docs: document Palette tab and palette: block in project.yaml"
```

### Task 5.2: Smoke run on coastal-planet, capture demo

**Step 1:** Build everything fresh.

```
pnpm -r build
```

**Step 2:** Start the preview server on the worked example.

```
node packages/cli/dist/cli.js preview packages/core/test/fixtures/coastal-planet --port 0
```

**Step 3:** Visit the URL printed. Verify:

- Preview tab shows the 5-page coastal-planet output.
- Palette tab shows tiles for `stage-direction`, `participant-name`, `yellow-tag`, `speaker-name`, `margin-label` (components) and `row`, `spanning-row`, `ad-lib` (templates), plus typography specimen.
- Help tab shows the built-in user guide (since the fixture has no `docs/user-guide.md`).
- Editing `styles.css` (e.g., change `--color-accent`) updates Preview and Palette tiles within ~2s.
- Switching tabs is instant (no Paged.js re-render delay).

If anything's wrong, fix and re-test before merging.

**Step 4:** No commit (this is verification, not code). If you make any fixes, commit them with descriptive messages.

---

## Acceptance criteria

Wave A is complete when all of these hold:

1. `pnpm -r typecheck && pnpm -r build && pnpm -r test` passes locally and in CI.
2. `tender preview <fixture>` opens a multi-tab UI; default tab is Preview.
3. The Palette tab shows tiles for every component and template defined in `project.yaml`, each with their actual rendered output and a copy-able snippet.
4. The Help tab shows either `docs/user-guide.md` (if present in the project) or the bundled built-in copy with a notice.
5. Live reload is selective: editing `content.md` reloads only the Preview iframe; editing `project.yaml` or `styles.css` reloads Preview AND Palette; editing `docs/user-guide.md` reloads Help.
6. Switching tabs is instant — no Paged.js re-render on tab switch.
7. The `palette:` block in `project.yaml` is documented in the user guide.

## What's deliberately not in Wave A

- No editing UI. Tiles are read-only.
- No filtering or search in Palette.
- No keyboard shortcuts beyond browser defaults.
- No theming for the SPA chrome itself.
- The visual builder (Wave B) is a separate design + plan, to be written after Wave A ships.
