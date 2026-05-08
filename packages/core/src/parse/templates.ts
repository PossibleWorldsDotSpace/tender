import { unified } from "unified";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import Handlebars from "handlebars";
import type { Plugin } from "unified";
import type { Root, RootContent } from "mdast";
import type { ProjectConfig } from "../config/schema.js";

interface DirectiveNode {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined>;
  children: RootContent[];
  data?: Record<string, unknown>;
}

interface HtmlNode {
  type: "html";
  value: string;
}

async function mdChildrenToHtml(children: RootContent[]): Promise<string> {
  const root: Root = { type: "root", children };
  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true });
  const hastTree = await processor.run(root);
  return processor.stringify(hastTree as never) as string;
}

export const resolveTemplates: Plugin<[ProjectConfig], Root> = (config) => {
  const templates = config.templates ?? {};
  const compiled = new Map<string, Handlebars.TemplateDelegate>();
  for (const [name, def] of Object.entries(templates)) {
    if (!def) continue;
    compiled.set(name, Handlebars.compile(def.template, { strict: false, noEscape: false }));
  }

  return async (tree: Root): Promise<Root> => {
    await walkAndReplace(tree, async (node) => {
      if (node.type !== "containerDirective" && node.type !== "leafDirective") return null;
      const dir = node as unknown as DirectiveNode;
      const def = templates[dir.name];
      if (!def) return null; // not a template — let component resolver handle it
      const fn = compiled.get(dir.name)!;

      const isMultiSlot = !!(def.slots && def.slots.length > 0);
      const split = isMultiSlot
        ? splitSlots(dir.children)
        : { body: dir.children, slots: {} as Record<string, RootContent[]> };

      const data: Record<string, unknown> = {};
      data.body = await mdChildrenToHtml(split.body);

      if (isMultiSlot) {
        for (const slot of def.slots!) {
          const children = split.slots[slot];
          if (!children || children.length === 0) {
            throw new Error(`Template '${dir.name}' is missing slot '${slot}'`);
          }
          data[slot] = await mdChildrenToHtml(children);
        }
      }

      if (def.params && dir.attributes) {
        for (const p of def.params) {
          const v = dir.attributes[p];
          if (v != null) data[p] = v;
        }
      }

      const html = fn(data);
      const replacement: HtmlNode = { type: "html", value: html };
      return replacement as unknown as RootContent;
    });
    return tree;
  };
};

function isSlotSentinel(node: RootContent): string | null {
  if (node.type !== "paragraph") return null;
  const para = node as unknown as { children: { type: string; value?: string }[] };
  if (para.children.length !== 1) return null;
  const child = para.children[0];
  if (!child || child.type !== "text" || typeof child.value !== "string") return null;
  const m = child.value.match(/^---\s+([\w-]+)\s+---$/);
  return m ? m[1]! : null;
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
  for (const child of children) {
    const sentinelName = isSlotSentinel(child);
    if (sentinelName) {
      current = result.slots[sentinelName] = [];
    } else {
      current.push(child);
    }
  }
  return result;
}

async function walkAndReplace(
  tree: Root,
  replacer: (node: RootContent) => Promise<RootContent | null>
): Promise<void> {
  async function recur(parent: { children: RootContent[] }): Promise<void> {
    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const replacement = await replacer(child);
      if (replacement) {
        children[i] = replacement;
        continue;
      }
      if ("children" in child && Array.isArray((child as { children?: unknown[] }).children)) {
        await recur(child as unknown as { children: RootContent[] });
      }
    }
  }
  await recur(tree);
}
