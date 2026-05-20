import { mkdir, readdir, copyFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));

const GITIGNORE_BASE = `# Node
node_modules/
dist/

# Misc
*.log
.DS_Store
`;

const GITIGNORE_OUT_BLOCK = `# Tender build output
out/

`;

/**
 * Body of the scaffolded `.gitignore`. When `trackOut` is true the `out/`
 * block is omitted so build artifacts (PDF/HTML) are version-controlled —
 * useful for users who diff or distribute the built output via git.
 */
function gitignoreBody(trackOut: boolean): string {
  return trackOut ? GITIGNORE_BASE : GITIGNORE_OUT_BLOCK + GITIGNORE_BASE;
}

// Templates directory is bundled adjacent to the dist/ dir at publish time.
// Two layouts to support:
//   - dev (tsc): here = packages/cli/dist/commands → ../../templates
//   - bundled (tsup): here = packages/cli/dist → ../templates
function templatesDir(name = "default"): string {
  const candidates = [
    resolve(here, "..", "templates", name),
    resolve(here, "..", "..", "templates", name)
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[candidates.length - 1]!;
}

// The tender-author skill payload (SKILL.md + examples/), copied next to
// dist/ at build time by tsup's onSuccess. Same dev/bundled dual layout
// as templatesDir():
//   - dev (tsc): here = packages/cli/dist/commands → ../../skill
//   - bundled (tsup): here = packages/cli/dist → ../skill
function skillDir(): string {
  const candidates = [
    resolve(here, "..", "skill"),
    resolve(here, "..", "..", "skill")
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[candidates.length - 1]!;
}

/** Where the skill scaffolds inside a project. Claude Code reads this. */
export const SKILL_PROJECT_PATH = ".claude/skills/tender-author";

/**
 * Examples the CLI ships under `templates/`, surfaced to both
 * `tender init --example=<name>` and the preview UI's "Load example" button.
 * Add a new entry by dropping a fixture-shaped directory under
 * `packages/cli/templates/<slug>/` and listing it here.
 */
export const KNOWN_EXAMPLES = ["open-circle"] as const;
export type ExampleName = (typeof KNOWN_EXAMPLES)[number];

/** Default example for `tender init --example` (no value supplied). */
export const DEFAULT_EXAMPLE: ExampleName = "open-circle";

export interface InitOptions {
  force?: boolean;
  /**
   * Scaffold from `templates/<example>/` instead of the minimal default.
   * The conflict policy is stricter for examples than for the default
   * template: any pre-existing file in the target that would be overwritten
   * causes init() to return `conflicts: [...]` and write nothing (unless
   * `force` is also set). The default template uses the historical
   * created/preserved/overwritten semantics regardless.
   */
  example?: ExampleName;
  /**
   * Install the tender-author Claude skill into the project at
   * `.claude/skills/tender-author/`. Default false: the CLI prompts on an
   * interactive terminal (defaulting to yes there) and passes the resolved
   * decision; a non-interactive caller gets no skill unless it opts in.
   */
  skill?: boolean;
  /**
   * Run `git init` (unless already in a work tree). Default true — this
   * preserves the historical always-init behaviour for non-interactive
   * callers. The CLI turns this into a prompt on a terminal.
   */
  git?: boolean;
  /**
   * Keep build output (`out/`) under version control by omitting it from
   * the scaffolded `.gitignore`. Default false (out/ is ignored).
   */
  trackOut?: boolean;
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
 *   - "skipped"        — caller opted out of git init (no repo created)
 */
export type InitGitAction = "created" | "already-repo" | "git-missing" | "init-failed" | "skipped";

export interface InitGitResult {
  action: InitGitAction;
  /** Set when action === "init-failed". */
  message?: string;
}

export interface InitResult {
  targetDir: string;
  files: InitFileResult[];
  git: InitGitResult;
  /**
   * Which template was scaffolded. `"default"` for the minimal starter; an
   * example name (e.g. `"open-circle"`) when `opts.example` was set.
   */
  template: string;
  /**
   * Populated only when an example install was refused due to existing files
   * (and `force` wasn't set). Each entry is a path relative to the target
   * directory that the example would have overwritten. When non-empty, no
   * files were written and `files` is empty.
   */
  conflicts: string[];
  /**
   * What happened with the tender-author skill:
   *   - "installed"  — scaffolded SKILL.md + examples/ into the project
   *   - "skipped"    — caller opted out (no skill written)
   *   - "exists"     — `.claude/skills/tender-author/` was already present;
   *                    left untouched (use `tender add-skill --force`)
   *   - "missing-payload" — the bundled skill payload wasn't found (a
   *                    packaging fault); scaffolding still succeeded
   */
  skill: "installed" | "skipped" | "exists" | "missing-payload";
  /** Whether the scaffolded `.gitignore` keeps `out/` tracked. */
  trackOut: boolean;
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
  const templateName = opts.example ?? "default";
  if (opts.example && !KNOWN_EXAMPLES.includes(opts.example)) {
    throw new Error(
      `Unknown example "${opts.example}". Available: ${KNOWN_EXAMPLES.join(", ")}.`
    );
  }
  const src = templatesDir(templateName);
  // Default git on (historical behaviour for non-interactive callers); the
  // CLI overrides this with the prompt's answer on a terminal.
  const wantGit = opts.git !== false;
  const trackOut = !!opts.trackOut;

  // For examples, do a preflight conflict check. Refusing to clobber is the
  // safer default; the user opts in with `force` once they've seen the list.
  if (opts.example && !opts.force) {
    const conflicts = await listConflicts(src, targetDir);
    if (conflicts.length > 0) {
      const git = wantGit ? await setupGit(targetDir) : { action: "skipped" as const };
      return {
        targetDir, files: [], git, template: templateName, conflicts,
        skill: "skipped", trackOut
      };
    }
  }

  const files: InitFileResult[] = [];
  await copyDir(src, targetDir, targetDir, !!opts.force, files);
  files.push(await writeGitignore(targetDir, !!opts.force, trackOut));
  const skill = opts.skill ? await installSkill(targetDir, !!opts.force) : "skipped";
  files.sort((a, b) => a.path.localeCompare(b.path));
  const git = wantGit ? await setupGit(targetDir) : { action: "skipped" as const };
  return { targetDir, files, git, template: templateName, conflicts: [], skill, trackOut };
}

/**
 * Copy the bundled tender-author skill payload into the project at
 * `.claude/skills/tender-author/`. Project-local so it travels with the
 * user's git repo (Claude Code reads project-local `.claude/skills/`).
 *
 * Shared by `tender init` (when the user opts in) and `tender add-skill`.
 * Refuses to clobber an existing skill dir unless `force` — re-running is
 * then a safe no-op that reports "exists".
 */
export async function installSkill(
  targetDir: string,
  force: boolean
): Promise<InitResult["skill"]> {
  const payload = skillDir();
  if (!existsSync(join(payload, "SKILL.md"))) return "missing-payload";
  const dest = join(targetDir, SKILL_PROJECT_PATH);
  if (existsSync(dest) && !force) return "exists";
  await mkdir(dest, { recursive: true });
  const files: InitFileResult[] = [];
  await copyDir(payload, dest, dest, true, files);
  return "installed";
}

/**
 * Human-readable result line for the standalone `tender add-skill` command.
 * Returns the message plus a process exit code (non-zero only when nothing
 * usable happened, so scripts can detect failure).
 */
export function formatSkillInstall(
  outcome: InitResult["skill"]
): { message: string; exitCode: number } {
  switch (outcome) {
    case "installed":
      return { message: `Installed the tender-author skill at ${SKILL_PROJECT_PATH}/.`, exitCode: 0 };
    case "exists":
      return {
        message: `Skill already present at ${SKILL_PROJECT_PATH}/. Re-run with --force to refresh it.`,
        exitCode: 0
      };
    case "missing-payload":
      return {
        message: "Skill payload not found in this build — could not install (packaging fault).",
        exitCode: 1
      };
    case "skipped":
      // Not reachable from add-skill (it always attempts an install), but
      // the union is exhaustive so handle it.
      return { message: "Skill install skipped.", exitCode: 1 };
  }
}

/**
 * Walk the template tree and return every file path (relative to the target)
 * that already exists at the destination. Used to refuse an example install
 * before it would clobber the user's work.
 */
async function listConflicts(srcDir: string, targetDir: string): Promise<string[]> {
  const conflicts: string[] = [];
  async function recur(srcSub: string, destSub: string): Promise<void> {
    const entries = await readdir(srcSub, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcSub, entry.name);
      const destPath = join(destSub, entry.name);
      if (entry.isDirectory()) {
        await recur(srcPath, destPath);
      } else {
        const exists = await stat(destPath).then(() => true).catch(() => false);
        if (exists) conflicts.push(relative(targetDir, destPath));
      }
    }
  }
  await recur(srcDir, targetDir);
  return conflicts.sort();
}

/**
 * Write a starter `.gitignore`. Same created/preserved/overwritten semantics
 * as the bundled template files: an existing one is left alone unless --force.
 *
 * Kept out of the template directory on purpose — npm strips files literally
 * named `.gitignore` from published tarballs, so we materialise it here.
 */
async function writeGitignore(
  targetDir: string,
  force: boolean,
  trackOut: boolean
): Promise<InitFileResult> {
  const dest = join(targetDir, ".gitignore");
  const body = gitignoreBody(trackOut);
  const exists = await stat(dest).then(() => true).catch(() => false);
  if (!exists) {
    await writeFile(dest, body);
    return { path: ".gitignore", action: "created" };
  }
  if (force) {
    await writeFile(dest, body);
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

  // Conflict refusal short-circuits everything else: nothing was written.
  if (result.conflicts.length > 0) {
    const n = result.conflicts.length;
    lines.push(`Refused to install the "${result.template}" example: ${n} file${n === 1 ? "" : "s"} already exist${n === 1 ? "s" : ""}:`);
    for (const p of result.conflicts) lines.push(`  ! ${p}`);
    lines.push("");
    lines.push("Re-run with --force to overwrite, or move the existing files aside first.");
    return lines.join("\n");
  }

  const created = result.files.filter(f => f.action === "created");
  const preserved = result.files.filter(f => f.action === "preserved");
  const overwritten = result.files.filter(f => f.action === "overwritten");

  if (created.length === 0 && preserved.length === 0 && overwritten.length === 0) {
    return `Initialized Tender project at ${result.targetDir} (no template files).`;
  }

  if (result.template !== "default") {
    lines.push(`Loaded example: ${result.template}.`);
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

  const skillLine = formatSkillLine(result.skill);
  if (skillLine) lines.push(skillLine);

  if (created.length === 0 && overwritten.length === 0) {
    lines.push("");
    lines.push("All template files already exist. Re-running `tender init` was a no-op.");
  }

  // Recoverability: if the skill isn't in the project, say how to add it
  // later so declining the prompt is a cheap, reversible choice.
  if (result.skill === "skipped" || result.skill === "missing-payload") {
    lines.push("Authoring skill not installed — add it anytime with: tender add-skill");
  }

  return lines.join("\n");
}

/**
 * Optional inputs to the end-of-init roundup. None are required — the
 * roundup degrades gracefully when the configurator didn't run, or when
 * git wasn't created. Kept as a flat options bag so `cli.ts` can build it
 * up as the flow progresses without coupling to internal driver types.
 */
export interface InitRoundup {
  /** Page-setup screen outcome — present only if the user opted in. */
  page?: {
    outcome: "applied" | "no-op" | "cancelled";
    editCount: number;
    addedTemplates: string[];
  };
  /** Design-tokens screen outcome — present only if the user opted in. */
  tokens?: {
    outcome: "applied" | "no-op" | "cancelled";
    editCount: number;
  };
  /** Outcome of the optional final commit step. `"none"` means no prompt was
   * offered (e.g. --no-commit, non-interactive, or git wasn't created). */
  commit?: "made" | "declined" | "failed" | "none";
}

/**
 * The consolidated "Done" view printed at the very end of `tender init`.
 * Pulls together what the user did in each stage — Setup (skill/git/files),
 * Configure (any project.yaml edits), Finish (the commit) — and ends with
 * the "Try: tender preview" pointer. Pure formatting; no I/O.
 *
 * Returns "" when the run was a refused-conflict short-circuit (we already
 * printed the diagnostic in formatInitResult and the user hasn't created
 * anything to round up).
 */
export function formatInitRoundup(
  result: InitResult,
  extras: InitRoundup = {}
): string {
  if (result.conflicts.length > 0) return "";

  const created = result.files.filter(f => f.action === "created");
  const overwritten = result.files.filter(f => f.action === "overwritten");
  if (created.length === 0 && overwritten.length === 0) {
    // Nothing happened at the scaffold level. Re-running tender init is a
    // no-op; the configurator may still have applied edits, so surface
    // those if present.
    const cfg = formatConfigureSummaryLines(extras);
    if (cfg.length === 0) return "";
    return ["Configuration applied:", ...cfg.map(s => `  ${s}`)].join("\n");
  }

  const lines: string[] = [];
  lines.push(`Your project is ready at ${result.targetDir}.`);
  lines.push("");

  // Scaffolded files header — already printed in detail by formatInitResult,
  // so this is the headline only.
  const scaffoldParts: string[] = [];
  if (created.length > 0) {
    scaffoldParts.push(`${created.length} file${created.length === 1 ? "" : "s"} created`);
  }
  if (overwritten.length > 0) {
    scaffoldParts.push(`${overwritten.length} overwritten`);
  }
  if (scaffoldParts.length > 0) {
    lines.push(`Scaffold: ${scaffoldParts.join(", ")}.`);
  }

  // Setup-stage status (git, skill).
  if (result.git.action === "created") lines.push("Git: initialized.");
  if (result.skill === "installed") lines.push("Skill: tender-author installed.");

  // Configure-stage changes, if the user ran them.
  const cfg = formatConfigureSummaryLines(extras);
  for (const l of cfg) lines.push(l);

  // Finish-stage status.
  if (extras.commit === "made") lines.push("Commit: initial commit recorded.");
  else if (extras.commit === "failed") lines.push("Commit: failed (see error above).");

  lines.push("");
  lines.push("Next: tender preview");
  return lines.join("\n");
}

/** Configure-stage outcome lines. Empty array when nothing ran or both
 * screens were no-ops/cancelled — keeps the roundup tight. */
function formatConfigureSummaryLines(extras: InitRoundup): string[] {
  const out: string[] = [];
  if (extras.page?.outcome === "applied") {
    const parts: string[] = [`${extras.page.editCount} change${extras.page.editCount === 1 ? "" : "s"}`];
    if (extras.page.addedTemplates.length > 0) {
      parts.push(`+ ${extras.page.addedTemplates.length} new template${extras.page.addedTemplates.length === 1 ? "" : "s"}`);
    }
    out.push(`Page templates: ${parts.join(", ")}.`);
    if (extras.page.addedTemplates.length > 0) {
      out.push(
        `  Use \`=== page{template=${extras.page.addedTemplates[0]}}\` in source to mark pages with ${
          extras.page.addedTemplates.length === 1 ? "it" : "one"
        }.`
      );
    }
  }
  if (extras.tokens?.outcome === "applied") {
    out.push(
      `Design tokens: ${extras.tokens.editCount} change${extras.tokens.editCount === 1 ? "" : "s"}.`
    );
  }
  return out;
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
    case "skipped":
      return null; // user opted out — no need to narrate the absence
  }
}

function formatSkillLine(skill: InitResult["skill"]): string | null {
  switch (skill) {
    case "installed":
      return `Installed the tender-author skill at ${SKILL_PROJECT_PATH}/.`;
    case "exists":
      return `Skill already present at ${SKILL_PROJECT_PATH}/ — left untouched.`;
    case "missing-payload":
      return "Skill payload not found in this build — could not install (packaging fault).";
    case "skipped":
      return null; // recoverability tip is printed separately
  }
}
