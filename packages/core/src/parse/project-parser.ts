import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { resolveTemplates } from "./templates.js";
import { resolveComponents } from "./components.js";
import type { ProjectConfig } from "../config/schema.js";

export interface ParseResult {
  html: string;
  /**
   * True when the source's first block-level node is a `:::page` directive,
   * indicating the document opens with an explicit page wrapper. Callers use
   * this to avoid double-wrapping in a default page.
   */
  startsWithPage: boolean;
}

export async function parseProject(source: string, config: ProjectConfig): Promise<ParseResult> {
  let startsWithPage = false;
  const detectStartsWithPage: Plugin<[], Root> = () => (tree) => {
    const first = tree.children[0];
    if (first && first.type === "containerDirective" && (first as { name?: string }).name === "page") {
      startsWithPage = true;
    }
  };

  const file = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(detectStartsWithPage)
    .use(resolveTemplates, config)
    .use(resolveComponents, config)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(source);
  return { html: String(file), startsWithPage };
}
