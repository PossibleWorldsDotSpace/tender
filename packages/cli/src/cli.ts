#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { build } from "./commands/build.js";
import { lint, formatReport } from "./commands/lint.js";
import { clean } from "./commands/clean.js";
import { startPreviewServer } from "./commands/preview.js";
import { init, formatInitResult } from "./commands/init.js";

const program = new Command();
program.name("tender").description("Print-layout tool for text documents");

program.command("build [dir]")
  .description("Build PDF and HTML from a project directory")
  .option("--out <path>", "output directory", "./out")
  .option("--pdf-only", "produce only PDF")
  .option("--html-only", "produce only HTML")
  .option("--timeout <ms>", "max time (ms) for Paged.js pagination (default 60000)")
  .action(async (dir: string | undefined, opts: { out: string; pdfOnly?: boolean; htmlOnly?: boolean; timeout?: string }) => {
    const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : undefined;
    if (opts.timeout && (!timeoutMs || timeoutMs <= 0)) {
      console.error(`error: --timeout must be a positive integer (got ${opts.timeout})`);
      process.exit(2);
    }
    await build({
      projectDir: resolve(dir ?? "."),
      outDir: resolve(opts.out),
      pdfOnly: opts.pdfOnly,
      htmlOnly: opts.htmlOnly,
      timeoutMs
    });
    console.log(`Built to ${resolve(opts.out)}`);
  });

program.command("lint [dir]")
  .description("Validate a project; surface deprecated syntax, unused components, and missing assets")
  .option("--strict", "promote warnings to errors for CI gating")
  .option("--json", "emit findings as JSON")
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

program.command("clean [path]")
  .description("Sanitise content.md: strip paste artifacts, optionally apply smart typography")
  .option("--check", "exit non-zero if changes are pending; don't write")
  .option("--yes", "skip the confirmation prompt; write immediately")
  .option("--typography", "apply smart-typography rules (default: off)")
  .action(async (path: string | undefined, opts: { check?: boolean; yes?: boolean; typography?: boolean }) => {
    const target = resolve(path ?? "content.md");
    const { summary, exitCode } = await clean(target, opts);
    if (summary) console.log(summary);
    if (exitCode !== 0) process.exit(exitCode);
  });

program.command("preview [dir]")
  .description("Live-reloading HTML preview server")
  .option("--port <n>", "port (default 3993; use 0 for auto)", "3993")
  .option("--host <addr>", "bind address (default 127.0.0.1; use 0.0.0.0 to expose on LAN/Tailscale)", "127.0.0.1")
  .action(async (dir: string | undefined, opts: { port: string; host: string }) => {
    const port = parseInt(opts.port, 10);
    const server = await startPreviewServer({
      projectDir: resolve(dir ?? "."),
      port: isNaN(port) ? 3993 : port,
      host: opts.host
    });
    console.log(`Preview at http://${server.host}:${server.port}/`);
    console.log("Press Ctrl-C to stop.");
    let shuttingDown = false;
    process.on("SIGINT", async () => {
      if (shuttingDown) {
        console.log("\nForce exit.");
        process.exit(1);
      }
      shuttingDown = true;
      console.log("\nStopping preview...");
      // Hard fallback in case close() hangs anyway
      const timer = setTimeout(() => process.exit(1), 3000);
      timer.unref();
      await server.close();
      process.exit(0);
    });
  });

program.command("init [dir]")
  .description("Scaffold a Tender project (idempotent; preserves existing files)")
  .option("--force", "overwrite existing files instead of preserving them")
  .action(async (dir: string | undefined, opts: { force?: boolean }) => {
    const target = resolve(dir ?? ".");
    const result = await init(target, opts);
    console.log(formatInitResult(result));
  });

program.parseAsync(process.argv);
