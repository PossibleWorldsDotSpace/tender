import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

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
    try {
      const buf = await readFile(join(projectDir, src));
      const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
      const replaced = fullTag.replace(src, dataUri);
      replacements.push({ original: fullTag, replaced });
    } catch {
      // File not found or unreadable — leave as-is
    }
  }

  let out = html;
  for (const { original, replaced } of replacements) {
    out = out.replace(original, replaced);
  }
  return out;
}
