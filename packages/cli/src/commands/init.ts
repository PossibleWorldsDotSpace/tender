import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
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

/**
 * Per-file outcome from `init()`. The CLI uses this to print a clear
 * summary so users always know exactly what happened to their files.
 */
export type InitFileAction = "created" | "preserved" | "overwritten";

export interface InitFileResult {
  /** Path relative to the target directory. */
  path: string;
  action: InitFileAction;
}

export interface InitResult {
  targetDir: string;
  files: InitFileResult[];
}

/**
 * Idempotent project scaffolding. For each file in the starter template:
 *   - Target doesn't exist → write ("created").
 *   - Target exists and `--force` → overwrite ("overwritten").
 *   - Target exists and not `--force` → preserve user's file ("preserved").
 *
 * Common flow: a user has a directory with their content.md already in it,
 * runs `tender init` (no arg), and gets a project.yaml + styles.css +
 * components/ scaffold layered on top of their existing prose. The
 * existing content.md is preserved — that's their work.
 *
 * Re-running `tender init` is safe: the second run reports every existing
 * file as "preserved" and writes nothing.
 */
export async function init(targetDir: string, opts: InitOptions = {}): Promise<InitResult> {
  await mkdir(targetDir, { recursive: true });
  const src = templatesDir();
  const files: InitFileResult[] = [];
  await copyDir(src, targetDir, targetDir, !!opts.force, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { targetDir, files };
}

async function copyDir(
  srcDir: string,
  destDir: string,
  rootDest: string,
  force: boolean,
  results: InitFileResult[]
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, rootDest, force, results);
    } else {
      const exists = await stat(destPath).then(() => true).catch(() => false);
      const relPath = relative(rootDest, destPath);
      if (!exists) {
        await copyFile(srcPath, destPath);
        results.push({ path: relPath, action: "created" });
      } else if (force) {
        await copyFile(srcPath, destPath);
        results.push({ path: relPath, action: "overwritten" });
      } else {
        results.push({ path: relPath, action: "preserved" });
      }
    }
  }
}

/**
 * Format the InitResult for human-readable terminal output.
 */
export function formatInitResult(result: InitResult): string {
  const lines: string[] = [];
  const created = result.files.filter(f => f.action === "created");
  const preserved = result.files.filter(f => f.action === "preserved");
  const overwritten = result.files.filter(f => f.action === "overwritten");

  if (created.length === 0 && preserved.length === 0 && overwritten.length === 0) {
    return `Initialized Tender project at ${result.targetDir} (no template files).`;
  }

  if (created.length > 0) {
    lines.push(`Created ${created.length} file${created.length === 1 ? "" : "s"}:`);
    for (const f of created) lines.push(`  + ${f.path}`);
  }

  if (overwritten.length > 0) {
    lines.push(`Overwrote ${overwritten.length} file${overwritten.length === 1 ? "" : "s"} (--force):`);
    for (const f of overwritten) lines.push(`  ! ${f.path}`);
  }

  if (preserved.length > 0) {
    lines.push(
      `Preserved ${preserved.length} existing file${preserved.length === 1 ? "" : "s"}:`
    );
    for (const f of preserved) lines.push(`  = ${f.path}`);
  }

  if (created.length === 0 && overwritten.length === 0) {
    lines.push("");
    lines.push("All template files already exist. Re-running `tender init` was a no-op.");
  } else {
    lines.push("");
    lines.push(`Project ready at ${result.targetDir}.`);
    lines.push("Try: tender preview");
  }

  return lines.join("\n");
}
