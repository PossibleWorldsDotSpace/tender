import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const RESERVED_DOC_NAMES = new Set<string>(["README.md"]);

export interface ProjectDocument {
  /** Filename, e.g. "resume.md". */
  filename: string;
  /** Basename without extension, e.g. "resume". */
  basename: string;
  /** Absolute path. */
  path: string;
  /** True for content.md. */
  isContent: boolean;
}

/**
 * Discover documents at the project root. A document is any *.md file
 * directly in projectDir that is not reserved. Reserved: README.md and
 * any filename starting with "_". Subdirectories are ignored.
 *
 * Sort order: content.md first (if present), then the rest alphabetically.
 */
export async function listDocuments(projectDir: string): Promise<ProjectDocument[]> {
  const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
  const docs: ProjectDocument[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".md")) continue;
    if (RESERVED_DOC_NAMES.has(e.name)) continue;
    if (e.name.startsWith("_")) continue;
    const basename = e.name.slice(0, -3);
    docs.push({
      filename: e.name,
      basename,
      path: join(projectDir, e.name),
      isContent: e.name === "content.md"
    });
  }
  docs.sort((a, b) => {
    if (a.isContent) return -1;
    if (b.isContent) return 1;
    return a.basename.localeCompare(b.basename);
  });
  return docs;
}
