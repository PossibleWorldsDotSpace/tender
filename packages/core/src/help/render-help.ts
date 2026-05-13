import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The user guide bundled with the CLI. At build time `packages/core/assets/`
 * receives a copy of `docs/user-guide.md` from the repo root (see the
 * `prebuild` script in `packages/core/package.json`), so what ships in npm
 * is always the current canonical guide. The Help tab reads this file
 * directly — there is no project-local override.
 */
const helpPath = join(here, "../../assets/builtin-user-guide.md");

export interface HelpResponse {
  html: string;
}

/**
 * Render the bundled user guide to HTML for the preview UI's Help tab.
 * Pure — same input file always yields the same output; no project state
 * involved.
 */
export async function renderHelp(): Promise<HelpResponse> {
  const raw = await readFile(helpPath, "utf8");
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(raw);
  return { html: String(file) };
}
