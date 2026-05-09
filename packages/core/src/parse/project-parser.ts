import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { resolveComponents } from "./components.js";
import { preprocessTags } from "./preprocess-tags.js";
import { preprocessPageBoundaries } from "./preprocess-page-boundaries.js";
import { preprocessInlineShortcuts } from "./preprocess-inline-shortcuts.js";
import { composeSourceMaps } from "./compose-source-maps.js";
import type { SourceMapEntry } from "./compose-source-maps.js";
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
  /**
   * Source map relating final-preprocessor-output positions back to the
   * original content.md offsets. Folded across preprocessPageBoundaries,
   * preprocessInlineShortcuts, and preprocessTags. Empty when
   * TENDER_TAG_SYNTAX=0 (no preprocessing was performed; positions
   * already match the input).
   *
   * No consumer reads this yet; it's the foundation for surfacing parser
   * errors with original-source positions in the LSP and CLI.
   */
  sourceMap: SourceMapEntry[];
}

/**
 * Tag-syntax preprocessing is on by default. The preprocessor rewrites
 * `<row …>body</row>` into the directive shape the existing pipeline already
 * handles. Source that doesn't use tag syntax (i.e. legacy `:::row…:::`
 * fixtures) passes through unchanged — the scanner finds no `<` followed by
 * a registered tag name, so the output equals the input.
 *
 * `TENDER_TAG_SYNTAX=0` disables the preprocessor entirely. This is an
 * emergency escape hatch for bisecting regressions; once item 7's
 * `tender migrate` command lands and projects are migrated, the flag (and
 * the legacy directive path) can be removed altogether.
 */
function tagSyntaxEnabled(): boolean {
  return process.env.TENDER_TAG_SYNTAX !== "0";
}

export async function parseProject(source: string, config: ProjectConfig): Promise<ParseResult> {
  let startsWithPage = false;
  const detectStartsWithPage: Plugin<[], Root> = () => (tree) => {
    const first = tree.children[0];
    if (first && first.type === "containerDirective" && (first as { name?: string }).name === "page") {
      startsWithPage = true;
    }
  };

  let processedSource: string;
  let sourceMap: SourceMapEntry[];

  if (tagSyntaxEnabled()) {
    const r1 = preprocessPageBoundaries(source);
    const shortcuts = config["inline-shortcuts"] ?? {};
    const r2 = preprocessInlineShortcuts(r1.source, shortcuts);
    const r3 = preprocessTags(r2.source, buildPreprocessOptions(config));
    processedSource = r3.source;
    sourceMap = composeSourceMaps([r1.sourceMap, r2.sourceMap, r3.sourceMap]);
  } else {
    processedSource = source;
    sourceMap = [];
  }

  const file = await unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(detectStartsWithPage)
    .use(resolveComponents, config)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processedSource);
  return { html: String(file), startsWithPage, sourceMap };
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
