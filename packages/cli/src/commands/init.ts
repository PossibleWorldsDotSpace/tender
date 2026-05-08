import { mkdir, readdir, copyFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Templates directory is bundled adjacent to the dist/ dir at publish time.
// At dev/test time, resolve relative to the source location.
// The CLI package layout: packages/cli/{src,dist}/commands/init.{ts,js}
// From here (.../commands/), package root is two levels up.
function templatesDir(): string {
  return resolve(here, "..", "..", "templates", "default");
}

export interface InitOptions {
  force?: boolean;
}

export async function init(targetDir: string, opts: InitOptions = {}): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const existing = await readdir(targetDir);
  if (existing.length > 0 && !opts.force) {
    throw new Error(`Target directory is not empty: ${targetDir} (use --force to overwrite)`);
  }
  const src = templatesDir();
  await copyDir(src, targetDir);
}

async function copyDir(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}
