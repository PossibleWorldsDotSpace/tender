import { mkdir, readdir, copyFile, stat, writeFile } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));

const GITIGNORE_BODY = `# Tender build output
out/

# Node
node_modules/
dist/

# Misc
*.log
.DS_Store
`;

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

/**
 * What happened on the git side of `init()`:
 *   - "created"        — we ran `git init` (the directory wasn't a repo)
 *   - "already-repo"   — the directory was already inside a git work tree
 *   - "git-missing"    — git isn't installed; we skipped repo setup
 *   - "init-failed"    — `git init` was attempted but errored (message kept)
 */
export type InitGitAction = "created" | "already-repo" | "git-missing" | "init-failed";

export interface InitGitResult {
  action: InitGitAction;
  /** Set when action === "init-failed". */
  message?: string;
}

export interface InitResult {
  targetDir: string;
  files: InitFileResult[];
  git: InitGitResult;
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
  files.push(await writeGitignore(targetDir, !!opts.force));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const git = await setupGit(targetDir);
  return { targetDir, files, git };
}

/**
 * Write a starter `.gitignore`. Same created/preserved/overwritten semantics
 * as the bundled template files: an existing one is left alone unless --force.
 *
 * Kept out of the template directory on purpose — npm strips files literally
 * named `.gitignore` from published tarballs, so we materialise it here.
 */
async function writeGitignore(targetDir: string, force: boolean): Promise<InitFileResult> {
  const dest = join(targetDir, ".gitignore");
  const exists = await stat(dest).then(() => true).catch(() => false);
  if (!exists) {
    await writeFile(dest, GITIGNORE_BODY);
    return { path: ".gitignore", action: "created" };
  }
  if (force) {
    await writeFile(dest, GITIGNORE_BODY);
    return { path: ".gitignore", action: "overwritten" };
  }
  return { path: ".gitignore", action: "preserved" };
}

async function isInsideGitWorkTree(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
    return stdout.trim() === "true";
  } catch {
    // Non-zero exit (not a repo) or git missing — caller distinguishes via
    // gitAvailable(); here a thrown error simply means "not inside a work tree".
    return false;
  }
}

async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialise a git repository in `targetDir` unless it's already inside one.
 * A missing git binary is not an error — scaffolding succeeds regardless.
 */
async function setupGit(targetDir: string): Promise<InitGitResult> {
  if (!(await gitAvailable())) return { action: "git-missing" };
  if (await isInsideGitWorkTree(targetDir)) return { action: "already-repo" };
  try {
    await execFileAsync("git", ["init"], { cwd: targetDir });
    return { action: "created" };
  } catch (err) {
    return { action: "init-failed", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stage everything in `targetDir` and make the first commit. Caller decides
 * whether to invoke this (e.g. after an interactive y/N prompt). Throws on
 * failure — typically an unconfigured `user.name`/`user.email`.
 */
export async function gitInitialCommit(targetDir: string, message = "Initial Tender project"): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd: targetDir });
  await execFileAsync("git", ["commit", "-m", message], { cwd: targetDir });
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

  const gitLine = formatGitLine(result.git);
  if (gitLine) lines.push(gitLine);

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

function formatGitLine(git: InitGitResult): string | null {
  switch (git.action) {
    case "created":
      return "Initialized a git repository.";
    case "already-repo":
      return null; // nothing to say — they're already version-controlled
    case "git-missing":
      return "git not found — skipped repository setup.";
    case "init-failed":
      return `git init failed — skipped repository setup (${git.message ?? "unknown error"}).`;
  }
}
