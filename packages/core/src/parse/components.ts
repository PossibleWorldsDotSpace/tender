import { unified } from "unified";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import Handlebars from "handlebars";
import type { Plugin } from "unified";
import type { Root, RootContent } from "mdast";
import type { ProjectConfig } from "../config/schema.js";
import { BUILTIN_COMPONENTS } from "../builtins.js";

interface ComponentDef {
  tag?: string;
  class?: string;
  params?: readonly string[];
  slots?: readonly string[];
  inline?: boolean;
  template?: string;
}

interface DirectiveNode {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined>;
  children: RootContent[];
  data?: Record<string, unknown>;
  position?: { start?: { line?: number; column?: number } };
}

interface HtmlNode {
  type: "html";
  value: string;
}

export function positionPrefix(
  node: { position?: { start?: { line?: number; column?: number } } },
  file = "content.md"
): string {
  const line = node.position?.start?.line;
  const col = node.position?.start?.column;
  if (line && col) return `${file}:${line}:${col}: `;
  if (line) return `${file}:${line}: `;
  return `${file}: `;
}

/**
 * Resolves every component directive in the tree. A component is either a
 * **wrapper** (no `template`; rendered as `<tag class="…" data-NAME="…">body</tag>`)
 * or a **block template** (with `template`; rendered by Handlebars with
 * `body`, declared params, and named slots passed as data).
 *
 * Resolution is post-order: a component's children are resolved before the
 * component itself. This lets a block-template component contain other
 * components in its body — the inner ones resolve first (becoming raw HTML
 * nodes), then the outer Handlebars template sees them as part of `{{{body}}}`.
 */
export const resolveComponents: Plugin<[ProjectConfig], Root> = (config) => {
  const userComponents = (config.components ?? {}) as Record<string, ComponentDef>;
  // Built-ins first; user-defined entries override.
  const components: Record<string, ComponentDef> = {
    ...BUILTIN_COMPONENTS,
    ...userComponents
  };
  const compiled = new Map<string, Handlebars.TemplateDelegate>();
  for (const [name, def] of Object.entries(components)) {
    if (def?.template) {
      compiled.set(name, Handlebars.compile(def.template, { strict: false, noEscape: false }));
    }
  }

  return async (tree: Root): Promise<Root> => {
    await walkAndReplace(tree, async (node) => {
      if (
        node.type !== "containerDirective" &&
        node.type !== "leafDirective" &&
        node.type !== "textDirective"
      ) return null;
      const dir = node as unknown as DirectiveNode;
      const def = components[dir.name];
      if (!def) {
        throw new Error(`${positionPrefix(dir)}Unknown component "${dir.name}"`);
      }
      if (def.template) {
        return await renderBlockTemplate(dir, def, compiled.get(dir.name)!, config);
      }
      // Wrapper component: set hast properties on the directive node so that
      // remark-rehype emits `<tag class="…" data-NAME="…">{children}</tag>`.
      if (def.inline && dir.type === "containerDirective") {
        throw new Error(`${positionPrefix(dir)}Component "${dir.name}" is inline-only; cannot use as a block`);
      }
      const data = (dir.data ??= {});
      data.hName = def.tag;
      const props: Record<string, string> = {};
      if (def.class) props.className = def.class;
      if (def.params && dir.attributes) {
        for (const k of def.params) {
          const v = dir.attributes[k];
          if (v != null) props[`data-${k}`] = v;
        }
      }
      data.hProperties = props;
      return null; // mutate-in-place; no replacement node
    });
    return tree;
  };
};

async function renderBlockTemplate(
  dir: DirectiveNode,
  def: ComponentDef,
  fn: Handlebars.TemplateDelegate,
  config: ProjectConfig
): Promise<RootContent> {
  const isMultiSlot = !!(def.slots && def.slots.length > 0);
  const split = isMultiSlot
    ? splitSlots(dir.children)
    : { body: dir.children, slots: {} as Record<string, RootContent[]> };

  const data: Record<string, unknown> = {};
  data.body = await mdChildrenToHtml(split.body, config);

  if (isMultiSlot) {
    for (const slot of def.slots!) {
      const children = split.slots[slot];
      if (!children || children.length === 0) {
        throw new Error(`${positionPrefix(dir)}Component '${dir.name}' is missing slot '${slot}'`);
      }
      data[slot] = await mdChildrenToHtml(children, config);
    }
  }

  if (def.params && dir.attributes) {
    for (const p of def.params) {
      const v = dir.attributes[p];
      if (v != null) data[p] = v;
    }
  }

  const html = fn(data);
  return { type: "html", value: html } as unknown as RootContent;
}

async function mdChildrenToHtml(children: RootContent[], config: ProjectConfig): Promise<string> {
  // Inner components inside a block-template body have already been replaced
  // with raw HTML nodes by post-order walkAndReplace, so we don't run the
  // resolver again here — just stringify.
  const root: Root = { type: "root", children };
  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true });
  const hastTree = await processor.run(root);
  return processor.stringify(hastTree as never) as string;
}

const SENTINEL_LINE_RE = /^---\s+([\w-]+)\s+---$/;

interface TextChild {
  type: string;
  value?: string;
}

interface ParagraphLike {
  type: "paragraph";
  children: TextChild[];
}

/**
 * Splits paragraph nodes where a sentinel line appears inline (as part of a
 * multi-line text run that the markdown parser merged into a single paragraph)
 * into a sequence of pseudo-nodes:
 *   - "paragraph" pieces for non-sentinel text
 *   - synthetic { type: "_slotSentinel", name } markers
 */
function explodeSentinels(children: RootContent[]): Array<RootContent | { type: "_slotSentinel"; name: string }> {
  const out: Array<RootContent | { type: "_slotSentinel"; name: string }> = [];
  for (const child of children) {
    if (child.type !== "paragraph") {
      out.push(child);
      continue;
    }
    const para = child as unknown as ParagraphLike;
    if (para.children.length === 1) {
      const only = para.children[0];
      if (only && only.type === "text" && typeof only.value === "string") {
        const m = only.value.match(SENTINEL_LINE_RE);
        if (m) {
          out.push({ type: "_slotSentinel", name: m[1]! });
          continue;
        }
      }
    }
    const first = para.children[0];
    if (first && first.type === "text" && typeof first.value === "string") {
      const lines = first.value.split("\n");
      const segments: Array<{ name?: string; lines: string[] }> = [{ lines: [] }];
      for (const line of lines) {
        const m = line.match(SENTINEL_LINE_RE);
        if (m) {
          segments.push({ name: m[1]!, lines: [] });
        } else {
          segments[segments.length - 1]!.lines.push(line);
        }
      }
      if (segments.length > 1) {
        const head = segments[0]!;
        const headText = head.lines.join("\n");
        const headChildren: TextChild[] = [];
        if (headText.length > 0) headChildren.push({ type: "text", value: headText });
        for (let i = 1; i < para.children.length; i++) headChildren.push(para.children[i]!);
        if (headChildren.length > 0) {
          out.push({ type: "paragraph", children: headChildren } as unknown as RootContent);
        }
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i]!;
          out.push({ type: "_slotSentinel", name: seg.name! });
          const text = seg.lines.join("\n");
          if (text.length > 0) {
            out.push({
              type: "paragraph",
              children: [{ type: "text", value: text }]
            } as unknown as RootContent);
          }
        }
        continue;
      }
    }
    out.push(child);
  }
  return out;
}

function splitSlots(children: RootContent[]): {
  body: RootContent[];
  slots: Record<string, RootContent[]>;
} {
  const result = {
    body: [] as RootContent[],
    slots: {} as Record<string, RootContent[]>
  };
  let current: RootContent[] = result.body;
  for (const item of explodeSentinels(children)) {
    if ((item as { type: string }).type === "_slotSentinel") {
      const name = (item as { name: string }).name;
      current = result.slots[name] = [];
    } else {
      current.push(item as RootContent);
    }
  }
  return result;
}

async function walkAndReplace(
  tree: Root,
  replacer: (node: RootContent) => Promise<RootContent | null>
): Promise<void> {
  // Post-order: descend into a node's children before considering the node
  // itself. This lets a block-template component's body see already-replaced
  // inner components (now raw HTML nodes), which is what makes nesting work.
  async function recur(parent: { children: RootContent[] }): Promise<void> {
    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if ("children" in child && Array.isArray((child as { children?: unknown[] }).children)) {
        await recur(child as unknown as { children: RootContent[] });
      }
      const replacement = await replacer(child);
      if (replacement) {
        children[i] = replacement;
      }
    }
  }
  await recur(tree);
}
