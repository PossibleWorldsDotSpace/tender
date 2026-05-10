#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { build } from "./commands/build.js";
import { lint, formatReport } from "./commands/lint.js";
import { clean } from "./commands/clean.js";
import { startPreviewServer } from "./commands/preview.js";
import { init, formatInitResult } from "./commands/init.js";
import { listTokens, formatTokensList } from "./commands/tokens.js";
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
  .option("--pdf-only", "produce only PDF")
  .option("--html-only", "produce only HTML")
  .option("--timeout <ms>", "max time (ms) for Paged.js pagination (default 60000)")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender build\n  $ tender build my-doc --pdf-only\n  $ tender build . --out dist --timeout 120000\n`
  )
  .action(async (dir: string | undefined, opts: { out: string; pdfOnly?: boolean; htmlOnly?: boolean; timeout?: string }) => {
    const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : undefined;
    if (opts.timeout && (!timeoutMs || timeoutMs <= 0)) {
      console.error(`${red("error")}: --timeout must be a positive integer (got ${opts.timeout})`);
      process.exit(2);
    }
    const what = opts.pdfOnly ? "PDF" : opts.htmlOnly ? "HTML" : "PDF + HTML";
    const spinner = startSpinner(`Building ${what}...`);
    try {
      await build({
        projectDir: resolve(dir ?? "."),
        outDir: resolve(opts.out),
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
  .description("Validate a project; surface deprecated syntax, unused components, and missing assets")
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
  .description("Sanitise content.md: strip paste artifacts, optionally apply smart typography")
  .option("--check", "exit non-zero if changes are pending; don't write")
  .option("--yes", "skip the confirmation prompt; write immediately")
  .option("--typography", "apply smart-typography rules (default: off)")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender clean                       # interactive: shows diff, prompts y/N\n  $ tender clean --check               # CI gate: exit 1 if pending\n  $ tender clean --yes --typography    # write quietly with smart quotes\n`
  )
  .action(async (path: string | undefined, opts: { check?: boolean; yes?: boolean; typography?: boolean }) => {
    const target = resolve(path ?? "content.md");
    const { summary, exitCode } = await clean(target, opts);
    if (summary) console.log(summary);
    if (exitCode !== 0) process.exit(exitCode);
  });

program
  .command("preview [dir]")
  .description("Live-reloading HTML preview server")
  .option("--port <n>", "port (default 3993; use 0 for auto)", "3993")
  .option("--host <addr>", "bind address (default 127.0.0.1; use 0.0.0.0 to expose on LAN/Tailscale)", "127.0.0.1")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender preview\n  $ tender preview my-doc --port 4000\n  $ tender preview --host 0.0.0.0     # expose on LAN/Tailscale\n`
  )
  .action(async (dir: string | undefined, opts: { port: string; host: string }) => {
    const port = parseInt(opts.port, 10);
    if (shouldShowBanner()) {
      process.stdout.write(renderBanner());
    }
    const spinner = startSpinner("Starting preview server...");
    let server: Awaited<ReturnType<typeof startPreviewServer>>;
    try {
      server = await startPreviewServer({
        projectDir: resolve(dir ?? "."),
        port: isNaN(port) ? 3993 : port,
        host: opts.host
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
  .option("--force", "overwrite existing files instead of preserving them")
  .addHelpText(
    "after",
    `\nExamples:\n  $ tender init                        # scaffold here\n  $ tender init my-doc                 # scaffold into ./my-doc\n  $ tender init --force                # overwrite (careful)\n`
  )
  .action(async (dir: string | undefined, opts: { force?: boolean }) => {
    const target = resolve(dir ?? ".");
    if (shouldShowBanner()) {
      process.stdout.write(renderBanner());
    }
    const result = await init(target, opts);
    console.log(formatInitResult(result));
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

// When no subcommand is given, print help. commander defaults to silently
// exiting 0, which feels like the CLI did nothing.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv);
