import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

export async function inlineAssets(html: string, projectDir: string): Promise<string> {
  const imgRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g;
  const replacements: Array<{ original: string; replaced: string }> = [];
  const matches = [...html.matchAll(imgRegex)];

  for (const match of matches) {
    const fullTag = match[0];
    const src = match[1];
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) continue;
    const ext = extname(src).toLowerCase();
    const mime = MIME_TYPES[ext];
    if (!mime) continue;
    const projectRoot = resolve(projectDir);
    const targetPath = resolve(projectRoot, src);
    if (!targetPath.startsWith(projectRoot + sep) && targetPath !== projectRoot) {
      // Path escapes projectDir; skip
      continue;
    }
    try {
      const buf = await readFile(targetPath);
      const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
      const replaced = fullTag.replace(src, dataUri);
      replacements.push({ original: fullTag, replaced });
    } catch {
      // File not found or unreadable — leave as-is
    }
  }

  let out = html;
  for (const { original, replaced } of replacements) {
    out = out.replaceAll(original, replaced);
  }
  return out;
}
