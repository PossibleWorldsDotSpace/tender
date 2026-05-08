import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const here = dirname(fileURLToPath(import.meta.url));
const builtinPath = join(here, "../../assets/builtin-user-guide.md");

export interface HelpResponse {
  html: string;
  source: "project" | "builtin";
}

export async function renderHelp(projectDir: string): Promise<HelpResponse> {
  const projectGuide = join(projectDir, "docs", "user-guide.md");
  let source: "project" | "builtin" = "project";
  let raw: string;
  try {
    raw = await readFile(projectGuide, "utf8");
  } catch {
    raw = await readFile(builtinPath, "utf8");
    source = "builtin";
  }
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(raw);
  return { html: String(file), source };
}
