#!/usr/bin/env node
import { Command } from "commander";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { build } from "./commands/build.js";
import { listDocuments } from "@tender/core";
import { lint, formatReport } from "./commands/lint.js";
import { clean } from "./commands/clean.js";
import { startPreviewServer } from "./commands/preview.js";
import { init, formatInitResult, formatInitRoundup, gitInitialCommit, installSkill, formatSkillInstall, SKILL_PROJECT_PATH, KNOWN_EXAMPLES, DEFAULT_EXAMPLE, type InitRoundup } from "./commands/init.js";
import type { ExampleName } from "./commands/init.js";
import { listTokens, formatTokensList, setToken } from "./commands/tokens.js";
import { configure } from "./commands/configure.js";
import { runPageSetup, runTokenPicker, copy } from "./config-edit/index.js";
import { renderBanner, shouldShowBanner } from "./ui/banner.js";
import { startSpinner } from "./ui/spinner.js";
import { confirm } from "./ui/prompt.js";
import { red, dim, cyan, section } from "./ui/style.js";

// Resolve the package version at runtime from the CLI's own package.json.
// `tender --version` previously hard-coded "0.0.0", which is fine in dev
// but lies as soon as the package is published. createRequire (vs an import
// assertion) keeps this portable across Node versions and avoids the
// `--experimental-json-modules` flag on older releases.
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command();

program
  .name("tender")
  .description(`${renderBanner()}\n  Define your templates in yaml. Build components in CSS. Add text in Markdown. Export to PDF.`)
  .version(pkg.version, "-v, --version", "show version");

// commander prints `description` before the usage line for the root command.
// That gives `tender --help` a banner header for free. Subcommand `--help`
// inherits commander's default layout; we add per-command examples below.

program
  .command("build [dir]")
  .description("Build PDF and HTML from a project directory")
  .option("--out <path>", "output directory", "./out")
  .option("--doc <name>", "build only the named document (basename, with or without .md)")
  .option("--pdf-only", "produce only PDF")
  .option("--html-only", "produce only HTML")
  .option("--timeout <ms>", "max time (ms) for Paged.js pagination (default 60000)")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender build\n  $ tender build my-doc --pdf-only\n  $ tender build . --doc resume\n  $ tender build . --out dist --timeout 120000\n`
  )
  .action(async (dir: string | undefined, opts: { out: string; doc?: string; pdfOnly?: boolean; htmlOnly?: boolean; timeout?: string }) => {
    const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : undefined;
    if (opts.timeout && (!timeoutMs || timeoutMs <= 0)) {
      console.error(`${red("error")}: --timeout must be a positive integer (got ${opts.timeout})`);
      process.exit(2);
    }
    const projectDir = resolve(dir ?? ".");
    if (opts.doc !== undefined) {
      if (opts.doc === "") {
        console.error(`${red("error")}: --doc requires a document name`);
        process.exit(2);
      }
      const docs = await listDocuments(projectDir);
      const requested = opts.doc.endsWith(".md") ? opts.doc.slice(0, -3) : opts.doc;
      if (!docs.some(d => d.basename === requested)) {
        const available = docs.map(d => d.basename).join(", ");
        console.error(`${red("error")}: no document "${opts.doc}". Available: ${available || "(none)"}`);
        process.exit(2);
      }
    }
    const what = opts.pdfOnly ? "PDF" : opts.htmlOnly ? "HTML" : "PDF + HTML";
    const spinner = startSpinner(opts.doc ? `Building ${what} for ${opts.doc}...` : `Building ${what}...`);
    try {
      await build({
        projectDir,
        outDir: resolve(opts.out),
        docName: opts.doc,
        pdfOnly: opts.pdfOnly,
        htmlOnly: opts.htmlOnly,
        timeoutMs
      });
      spinner.succeed(`Built ${what} → ${cyan(resolve(opts.out))}`);
    } catch (err) {
      spinner.fail(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command("lint [dir]")
  .description("Validate a project; surface deprecated syntax, unused/unknown components, missing assets, and design-token issues")
  .option("--strict", "promote warnings to errors for CI gating")
  .option("--json", "emit findings as JSON")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender lint\n  $ tender lint my-doc --strict\n  $ tender lint --json | jq '.findings[] | select(.severity=="error")'\n`
  )
  .action(async (dir: string | undefined, opts: { strict?: boolean; json?: boolean }) => {
    const projectDir = resolve(dir ?? ".");
    const { report, exitCode } = await lint(projectDir, opts);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatReport(report, projectDir));
    }
    if (exitCode !== 0) process.exit(exitCode);
  });

program
  .command("clean [path]")
  .description("Sanitise a document: strip paste artifacts, optionally apply smart typography")
  .option("--check", "exit non-zero if changes are pending; don't write")
  .option("--yes", "skip the confirmation prompt; write immediately")
  .option("--typography", "apply smart-typography rules (default: off)")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender clean                       # interactive: shows diff, prompts y/N\n  $ tender clean --check               # CI gate: exit 1 if pending\n  $ tender clean --yes --typography    # write quietly with smart quotes\n`
  )
  .action(async (path: string | undefined, opts: { check?: boolean; yes?: boolean; typography?: boolean }) => {
    let target: string;
    if (path) {
      target = resolve(path);
    } else {
      const docs = await listDocuments(resolve("."));
      if (docs.length > 1) {
        const names = docs.map(d => d.filename).join(", ");
        console.error(`${red("error")}: multiple documents found — pass a path. Available: ${names}`);
        process.exit(2);
      }
      target = resolve(docs[0]?.filename ?? "content.md");
    }
    const { summary, exitCode } = await clean(target, opts);
    if (summary) console.log(summary);
    if (exitCode !== 0) process.exit(exitCode);
  });

program
  .command("preview [dir]")
  .description("Live-reloading HTML preview server")
  .option("--port <n>", "port (default 3993; use 0 for auto)", "3993")
  .option("--host <addr>", "bind address (default 127.0.0.1; use 0.0.0.0 to expose on LAN/Tailscale)", "127.0.0.1")
  .option("--doc <name>", "preselect a document in the preview UI (basename without .md)")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender preview\n  $ tender preview my-doc --port 4000\n  $ tender preview . --doc resume\n  $ tender preview --host 0.0.0.0     # expose on LAN/Tailscale\n`
  )
  .action(async (dir: string | undefined, opts: { port: string; host: string; doc?: string }) => {
    const port = parseInt(opts.port, 10);
    const projectDir = resolve(dir ?? ".");
    let docName: string | undefined;
    if (opts.doc !== undefined) {
      if (opts.doc === "") {
        console.error(`${red("error")}: --doc requires a document name`);
        process.exit(2);
      }
      const available = await listDocuments(projectDir);
      const requested = opts.doc.endsWith(".md") ? opts.doc.slice(0, -3) : opts.doc;
      if (!available.some(d => d.basename === requested)) {
        const names = available.map(d => d.basename).join(", ");
        console.error(`${red("error")}: no document "${opts.doc}". Available: ${names || "(none)"}`);
        process.exit(2);
      }
      docName = requested;
    }
    if (shouldShowBanner()) {
      process.stdout.write(renderBanner());
    }
    const spinner = startSpinner("Starting preview server...");
    let server: Awaited<ReturnType<typeof startPreviewServer>>;
    try {
      server = await startPreviewServer({
        projectDir,
        port: isNaN(port) ? 3993 : port,
        host: opts.host,
        docName
      });
      spinner.succeed(`Preview ready at ${cyan(`http://${server.host}:${server.port}/`)}`);
    } catch (err) {
      spinner.fail(`Failed to start preview: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    console.log(dim("  Watching for changes. Press Ctrl-C to stop."));
    let shuttingDown = false;
    process.on("SIGINT", async () => {
      if (shuttingDown) {
        console.log(dim("\nForce exit."));
        process.exit(1);
      }
      shuttingDown = true;
      console.log(dim("\nStopping preview..."));
      const timer = setTimeout(() => process.exit(1), 3000);
      timer.unref();
      await server.close();
      process.exit(0);
    });
  });

program
  .command("init [dir]")
  .description("Scaffold a Tender project (idempotent; preserves existing files)")
  .option("--force", "overwrite existing files instead of preserving them (also overrides --example's conflict refusal)")
  .option("--no-commit", "don't offer to make an initial git commit")
  .option("--skill", "install the tender-author Claude skill (skips the prompt)")
  .option("--no-skill", "don't install the skill (skips the prompt)")
  .option("--git", "git init (skips the prompt)")
  .option("--no-git", "don't git init (skips the prompt)")
  .option("--track-out", "keep build output (out/) under version control (skips the prompt)")
  .option("--ignore-out", "ignore out/ in .gitignore (skips the prompt)")
  .option("--configure-page", "after scaffolding, open the page-setup screen (skips the prompt)")
  .option("--no-configure-page", "don't open page setup (skips the prompt)")
  .option("--configure-tokens", "after scaffolding, open the token picker (skips the prompt)")
  .option("--no-configure-tokens", "don't open the token picker (skips the prompt)")
  .option(
    "--example [name]",
    `scaffold a worked example instead of the minimal starter (available: ${KNOWN_EXAMPLES.join(", ")}; default: ${DEFAULT_EXAMPLE})`
  )
  .addHelpText(
    "after",
    `\nInteractive on a terminal: prompts for the skill, git init, whether to\ntrack out/, then optionally page setup and design tokens. Pass the\nmatching flag to skip a prompt. Non-interactive (piped / CI) defaults:\ngit init yes, skill no, out/ ignored, no configurator.\n\nExamples:\n  $ tender init                        # scaffold here, then prompt\n  $ tender init my-doc                 # scaffold into ./my-doc\n  $ tender init --skill --git          # non-interactive, install skill + git init\n  $ tender init --no-skill --no-git    # scaffold files only\n  $ tender init --configure-page       # scaffold, then open page setup\n  $ tender init --track-out            # keep out/ in git\n  $ tender init --example              # scaffold the open-circle worked example\n  $ tender init --force                # overwrite (careful)\n`
  )
  .action(async (dir: string | undefined, opts: {
    force?: boolean; commit?: boolean; example?: string | boolean;
    skill?: boolean; git?: boolean; trackOut?: boolean; ignoreOut?: boolean;
    configurePage?: boolean; configureTokens?: boolean;
  }) => {
    const target = resolve(dir ?? ".");
    if (shouldShowBanner()) {
      process.stdout.write(renderBanner());
    }
    // --example with no value -> use the default example; with a value -> validate.
    let example: ExampleName | undefined;
    if (opts.example !== undefined && opts.example !== false) {
      const name = opts.example === true ? DEFAULT_EXAMPLE : opts.example;
      if (!(KNOWN_EXAMPLES as readonly string[]).includes(name)) {
        console.error(`${red("error")}: unknown example "${name}". Available: ${KNOWN_EXAMPLES.join(", ")}.`);
        process.exit(2);
      }
      example = name as ExampleName;
    }

    const interactive = process.stdin.isTTY === true;

    // ─── Setup ───────────────────────────────────────────────────────────
    // The three baseline choices: skill, git, out/ tracking. Section header
    // only emitted on an interactive TTY — on a pipe/CI the headings would
    // just be visual noise around prompts the user never sees.
    if (interactive) process.stdout.write(section("Setup"));

    // Resolve each decision: an explicit flag always wins; otherwise prompt
    // on a terminal; otherwise fall back to the documented non-interactive
    // default (git yes — historical behaviour; skill no; out/ ignored).
    const skill = await resolveDecision(opts.skill, interactive, "Install the tender-author Claude skill?", true, false);
    const git = await resolveDecision(opts.git, interactive, "Initialize a git repository?", true, true);
    // trackOut: --track-out => true, --ignore-out => false, else prompt/default.
    const trackOutFlag = opts.trackOut === true ? true : opts.ignoreOut === true ? false : undefined;
    const trackOut = await resolveDecision(trackOutFlag, interactive, "Keep build output (out/) under version control?", false, false);

    const result = await init(target, { force: opts.force, example, skill, git, trackOut });
    console.log(formatInitResult(result));
    if (result.conflicts.length > 0) {
      process.exit(1); // signal "did not install"; clear from the printed output
    }

    // ─── Configure ───────────────────────────────────────────────────────
    // Two optional configurator steps, after scaffolding (so project.yaml
    // exists) and before the commit prompt (so a commit captures the
    // configured file). Both default no, are independent, TTY-only, and
    // flag-skippable. Non-interactive: skipped entirely. They run the same
    // drivers `tender configure` uses, against the just-scaffolded project.
    if (interactive) process.stdout.write(section("Configure"));

    const summarizeOutcome = (
      screen: string,
      r: { outcome: "applied" | "no-op" | "cancelled"; editCount: number }
    ): string =>
      r.outcome === "applied" ? copy.outcome.applied(screen, r.editCount)
        : r.outcome === "no-op" ? copy.outcome.noop(screen)
        : copy.outcome.cancelled(screen);

    const roundup: InitRoundup = {};

    const wantPage = await resolveDecision(
      opts.configurePage, interactive,
      copy.initPrompt.page, false, false
    );
    if (wantPage) {
      try {
        const r = await runPageSetup(target);
        roundup.page = {
          outcome: r.outcome, editCount: r.editCount, addedTemplates: r.addedTemplates
        };
        console.log(dim(`  ${summarizeOutcome(copy.page.title, r)}`));
        if (r.outcome === "applied" && r.addedTemplates.length > 0) {
          console.log(dim(`  ${copy.outcome.addedTemplatesNextStep(r.addedTemplates.map(t => t.name))}`));
        }
      } catch (err) {
        console.error(`${red(`${copy.page.title} failed`)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const wantTokens = await resolveDecision(
      opts.configureTokens, interactive,
      copy.initPrompt.tokens, false, false
    );
    if (wantTokens) {
      try {
        const r = await runTokenPicker(target);
        roundup.tokens = {
          outcome: r.outcome, editCount: r.editCount, addedTokens: r.addedTokens
        };
        console.log(dim(`  ${summarizeOutcome(copy.tokens.title, r)}`));
      } catch (err) {
        console.error(`${red(`${copy.tokens.title} failed`)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ─── Finish ──────────────────────────────────────────────────────────
    // Offer an initial commit only when we just created the repo, the user
    // didn't pass --no-commit, and we're on an interactive terminal (no point
    // prompting a script — and a scripted caller can run `git commit` itself).
    const offerCommit = result.git.action === "created" && opts.commit !== false && interactive;
    if (offerCommit) {
      process.stdout.write(section("Finish"));
      if (await confirm("Make an initial commit?", false)) {
        try {
          await gitInitialCommit(target);
          roundup.commit = "made";
          console.log(dim("  Committed."));
        } catch (err) {
          roundup.commit = "failed";
          console.error(`${red("git commit failed")}: ${err instanceof Error ? err.message : String(err)}`);
          console.error(dim("  Configure git (git config user.name / user.email) and commit when ready."));
        }
      } else {
        roundup.commit = "declined";
      }
    } else {
      roundup.commit = "none";
    }

    // ─── Done ────────────────────────────────────────────────────────────
    // Final roundup: one consolidated view of what changed across all three
    // stages, so a user finishing the flow sees one clear "you did this"
    // panel rather than scattered status lines. Skipped silently on the
    // refused-conflict path (formatInitResult already explained why nothing
    // happened).
    const roundupText = formatInitRoundup(result, roundup);
    if (roundupText) {
      if (interactive) process.stdout.write(section("Done"));
      console.log(roundupText);
    }
  });

/**
 * Resolve a yes/no init decision. An explicit flag (true/false) wins
 * outright; on an interactive terminal we prompt (with `defaultYes`
 * controlling the Enter answer); non-interactive falls back to
 * `nonInteractiveDefault` so scripts/CI get stable, documented behaviour.
 */
async function resolveDecision(
  flag: boolean | undefined,
  interactive: boolean,
  question: string,
  defaultYes: boolean,
  nonInteractiveDefault: boolean
): Promise<boolean> {
  if (flag !== undefined) return flag;
  if (interactive) return confirm(question, defaultYes);
  return nonInteractiveDefault;
}

program
  .command("add-skill [dir]")
  .description(`Install the tender-author Claude skill into a project (${SKILL_PROJECT_PATH}/)`)
  .option("--force", "overwrite an existing skill directory with the bundled copy")
  .addHelpText(
    "after",
    `\nThe skill is project-local — it lives in your repo and travels with it.\nClaude Code picks it up automatically when the project is open.\n\nExamples:\n  $ tender add-skill            # install into the current project\n  $ tender add-skill my-doc     # install into ./my-doc\n  $ tender add-skill --force    # refresh an existing skill copy\n`
  )
  .action(async (dir: string | undefined, opts: { force?: boolean }) => {
    const target = resolve(dir ?? ".");
    const outcome = await installSkill(target, !!opts.force);
    const { message, exitCode } = formatSkillInstall(outcome);
    if (exitCode === 0) console.log(message);
    else console.error(`${red("error")}: ${message}`);
    if (exitCode !== 0) process.exit(exitCode);
  });

program
  .command("configure [dir]")
  .description("Interactively adjust page setup and design tokens (TTY required)")
  .option("--page-only", "configure page size/margins only (skip the token picker)")
  .option("--tokens-only", "configure design tokens only (skip page setup)")
  .addHelpText(
    "after",
    `\nEdits project.yaml in place, preserving comments and unrelated keys.\nEach screen ends with a diff you confirm before anything is written —\nEnter-through changes nothing. Re-runnable any time. Does not scaffold,\ngit init, or touch the skill (that's \`tender init\`).\n\nExamples:\n  $ tender configure              # page setup, then design tokens\n  $ tender configure my-doc       # against ./my-doc\n  $ tender configure --page-only  # just size/margins\n  $ tender configure --tokens-only\n`
  )
  .action(async (dir: string | undefined, opts: { pageOnly?: boolean; tokensOnly?: boolean }) => {
    if (opts.pageOnly && opts.tokensOnly) {
      console.error(`${red("error")}: ${copy.pageTokensExclusive}`);
      process.exit(2);
    }
    if (shouldShowBanner()) {
      process.stdout.write(renderBanner());
    }
    try {
      const res = await configure(resolve(dir ?? "."), {
        pageOnly: opts.pageOnly,
        tokensOnly: opts.tokensOnly
      });
      for (const line of res.lines) console.log(line);
    } catch (err) {
      console.error(`${red("error")}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

const tokensCmd = program
  .command("tokens")
  .description("Inspect and edit design tokens");

tokensCmd
  .command("list [dir]")
  .description("List the project's design tokens")
  .option("--json", "emit tokens as JSON")
  .addHelpText("after", "\nExamples:\n  $ tender tokens list\n  $ tender tokens list --json | jq '.color'\n")
  .action(async (dir: string | undefined, opts: { json?: boolean }) => {
    const projectDir = resolve(dir ?? ".");
    const tokens = await listTokens(projectDir);
    if (opts.json) {
      console.log(JSON.stringify(tokens, null, 2));
    } else {
      console.log(formatTokensList(tokens));
    }
  });

tokensCmd
  .command("set <token> <value> [dir]")
  .description("Set a design token value, creating it if it doesn't exist (writes project.yaml in place)")
  .addHelpText("after", "\nExamples:\n  $ tender tokens set color.accent '#c33'\n  $ tender tokens set size.body 11pt\n")
  .action(async (token: string, value: string, dir: string | undefined) => {
    const projectDir = resolve(dir ?? ".");
    const result = await setToken(projectDir, token, value);
    const before = result.created ? dim("(new)") : (result.previous ?? "");
    console.log(`  ${cyan(token)}: ${before} → ${result.next}`);
    console.log(dim(`  Wrote ${join(projectDir, "project.yaml")}.`));
  });

// `tokens edit` was retired in favour of `tender configure` (#17 slice 4):
// the design-token picker now lives in the unified configurator alongside
// page setup, with the mandatory diff-before-write. `tokens list`/`set`
// stay as the non-interactive surfaces.

// When no subcommand is given, print help. commander defaults to silently
// exiting 0, which feels like the CLI did nothing.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv);
