import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The user guide bundled with the CLI. Two locations need to resolve:
 *   - dev (unbundled): here = packages/core/dist/help → ../../assets/...
 *   - published CLI bundle: here = packages/cli/dist → ../assets/... (copied
 *     in by tsup's onSuccess step; see packages/cli/tsup.config.ts)
 * At build time `packages/core/assets/builtin-user-guide.md` is regenerated
 * from `docs/user-guide.md` (see core's `prebuild` script) so what ships in
 * npm is always the current canonical guide.
 */
function resolveHelpPath(): string {
  const candidates = [
    join(here, "../assets/builtin-user-guide.md"),
    join(here, "../../assets/builtin-user-guide.md")
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[candidates.length - 1]!;
}
const helpPath = resolveHelpPath();

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
