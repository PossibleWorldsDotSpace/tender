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
 *
 * This lets the slot splitter treat sentinels uniformly whether they appear as
 * standalone paragraphs or as embedded lines.
 */
function explodeSentinels(children: RootContent[]): Array<RootContent | { type: "_slotSentinel"; name: string }> {
  const out: Array<RootContent | { type: "_slotSentinel"; name: string }> = [];
  for (const child of children) {
    if (child.type !== "paragraph") {
      out.push(child);
      continue;
    }
    const para = child as unknown as ParagraphLike;
    // Whole-paragraph sentinel (single text child whose value matches).
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
    // Otherwise, look for a leading text child whose value contains a sentinel
    // line. We only handle the common case where the sentinel is the first
    // line of the text (with the slot body following on subsequent lines).
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
        // First segment retains the rest of the paragraph's children; later
        // segments get only the post-sentinel text from this text node.
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
