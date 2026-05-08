import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { resolveTemplates } from "./templates.js";
import { resolveComponents } from "./components.js";
import type { ProjectConfig } from "../config/schema.js";

export async function parseProject(source: string, config: ProjectConfig): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(resolveTemplates, config)
    .use(resolveComponents, config)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(source);
  return String(file);
}
