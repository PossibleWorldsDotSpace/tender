import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

export interface ParseOptions { allowDirectives?: boolean }

export async function parseMarkdown(source: string, opts: ParseOptions = {}): Promise<string> {
  const base = unified().use(remarkParse);
  const withDirective = opts.allowDirectives ? base.use(remarkDirective) : base;
  const file = await withDirective.use(remarkRehype).use(rehypeStringify).process(source);
  return String(file);
}
