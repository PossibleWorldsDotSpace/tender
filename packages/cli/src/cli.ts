#!/usr/bin/env node
import { Command } from "commander";
import { resolve, join } from "node:path";
import { build } from "./commands/build.js";
import { listDocuments } from "@tender/core";
import { lint, formatReport } from "./commands/lint.js";
import { clean } from "./commands/clean.js";
import { startPreviewServer } from "./commands/preview.js";
import { init, formatInitResult, gitInitialCommit, KNOWN_EXAMPLES, DEFAULT_EXAMPLE } from "./commands/init.js";
import type { ExampleName } from "./commands/init.js";
import { listTokens, formatTokensList, setToken, editTokens } from "./commands/tokens.js";
import { renderBanner, shouldShowBanner } from "./ui/banner.js";
import { startSpinner } from "./ui/spinner.js";
import { red, dim, cyan } from "./ui/style.js";

const program = new Command();

program
  .name("tender")
  .description(`${renderBanner()}\n  Define your templates in yaml. Build components in CSS. Add text in Markdown. Export to PDF.`)
  .version("0.0.0", "-v, --version", "show version");

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
  .description("Scaffold a Tender project (idempotent; preserves existing files; git init)")
  .option("--force", "overwrite existing files instead of preserving them (also overrides --example's conflict refusal)")
  .option("--no-commit", "don't offer to make an initial git commit")
  .option(
    "--example [name]",
    `scaffold a worked example instead of the minimal starter (available: ${KNOWN_EXAMPLES.join(", ")}; default: ${DEFAULT_EXAMPLE})`
  )
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender init                        # scaffold here, git init, prompt for first commit\n  $ tender init my-doc                 # scaffold into ./my-doc\n  $ tender init --example              # scaffold the open-circle worked example\n  $ tender init --example=open-circle  # same, explicit\n  $ tender init --force                # overwrite (careful)\n  $ tender init --no-commit            # skip the initial-commit prompt\n`
  )
  .action(async (dir: string | undefined, opts: { force?: boolean; commit?: boolean; example?: string | boolean }) => {
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
    const result = await init(target, { force: opts.force, example });
    console.log(formatInitResult(result));
    if (result.conflicts.length > 0) {
      process.exit(1); // signal "did not install"; clear from the printed output
    }

    // Offer an initial commit only when we just created the repo, the user
    // didn't pass --no-commit, and we're on an interactive terminal (no point
    // prompting a script — and a scripted caller can run `git commit` itself).
    if (result.git.action === "created" && opts.commit !== false && process.stdin.isTTY) {
      process.stdout.write("Make an initial commit? [y/N] ");
      const answer = await new Promise<string>(res => {
        process.stdin.once("data", chunk => res(chunk.toString()));
      });
      if (/^\s*y(es)?\s*$/i.test(answer)) {
        try {
          await gitInitialCommit(target);
          console.log(dim("  Committed."));
        } catch (err) {
          console.error(`${red("git commit failed")}: ${err instanceof Error ? err.message : String(err)}`);
          console.error(dim("  Configure git (git config user.name / user.email) and commit when ready."));
        }
      }
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

tokensCmd
  .command("edit [dir]")
  .description("Interactive picker for design tokens (TTY required)")
  .action(async (dir: string | undefined) => {
    await editTokens(resolve(dir ?? "."));
  });

// When no subcommand is given, print help. commander defaults to silently
// exiting 0, which feels like the CLI did nothing.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv);
