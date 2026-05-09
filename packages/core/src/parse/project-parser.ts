import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { resolveComponents } from "./components.js";
import { preprocessTags } from "./preprocess-tags.js";
import { BUILTIN_COMPONENTS } from "../builtins.js";
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

/**
 * Tag-syntax preprocessing is gated by `TENDER_TAG_SYNTAX=1` for now. The
 * preprocessor rewrites `<row …>body</row>` into the directive shape the
 * existing pipeline already handles, so when the flag is set the only
 * change is in how authors spell components in `content.md` — every other
 * stage of the parser (component resolution, palette, lint, render) runs
 * unchanged.
 */
function tagSyntaxEnabled(): boolean {
  return process.env.TENDER_TAG_SYNTAX === "1";
}

export async function parseProject(source: string, config: ProjectConfig): Promise<ParseResult> {
  let startsWithPage = false;
  const detectStartsWithPage: Plugin<[], Root> = () => (tree) => {
    const first = tree.children[0];
    if (first && first.type === "containerDirective" && (first as { name?: string }).name === "page") {
      startsWithPage = true;
    }
  };

  const processedSource = tagSyntaxEnabled()
    ? preprocessTags(source, buildPreprocessOptions(config)).source
    : source;

  const file = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(detectStartsWithPage)
    .use(resolveComponents, config)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processedSource);
  return { html: String(file), startsWithPage };
}

function buildPreprocessOptions(config: ProjectConfig): {
  registry: Set<string>;
  inlineNames: Set<string>;
} {
  const registry = new Set<string>();
  const inlineNames = new Set<string>();
  for (const name of Object.keys(BUILTIN_COMPONENTS)) registry.add(name);
  for (const [name, def] of Object.entries(config.components ?? {})) {
    if (!def) continue;
    registry.add(name);
    if (def.inline) inlineNames.add(name);
  }
  return { registry, inlineNames };
}
