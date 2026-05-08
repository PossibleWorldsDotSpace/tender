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
    return (await parseProject(src, config)).html;
  }
  const attrPart = Object.entries(attrs).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
  const head = attrPart ? `:::${name}{${attrPart}}` : `:::${name}`;
  const src = `${head}\n\n${body}\n\n:::\n`;
  return (await parseProject(src, config)).html;
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
  return (await parseProject(src, config)).html;
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
