#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { build } from "./commands/build.js";
import { lint } from "./commands/lint.js";
import { startPreviewServer } from "./commands/preview.js";
import { init } from "./commands/init.js";

const program = new Command();
program.name("tender").description("Print-layout tool for text documents");

program.command("build [dir]")
  .description("Build PDF and HTML from a project directory")
  .option("--out <path>", "output directory", "./out")
  .option("--pdf-only", "produce only PDF")
  .option("--html-only", "produce only HTML")
  .action(async (dir: string | undefined, opts: { out: string; pdfOnly?: boolean; htmlOnly?: boolean }) => {
    await build({
      projectDir: resolve(dir ?? "."),
      outDir: resolve(opts.out),
      pdfOnly: opts.pdfOnly,
      htmlOnly: opts.htmlOnly
    });
    console.log(`Built to ${resolve(opts.out)}`);
  });

program.command("lint [dir]")
  .description("Validate a project's config and content; exit non-zero on errors")
  .action(async (dir: string | undefined) => {
    const result = await lint(resolve(dir ?? "."));
    for (const w of result.warnings) console.warn(`warning: ${w}`);
    for (const e of result.errors) console.error(`error: ${e}`);
    if (result.errors.length > 0) process.exit(1);
    console.log("ok");
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

program.command("init <dir>")
  .description("Scaffold a new Tender project")
  .option("--force", "overwrite an existing directory")
  .action(async (dir: string, opts: { force?: boolean }) => {
    await init(resolve(dir), opts);
    console.log(`Initialized Tender project at ${resolve(dir)}`);
    console.log(`Try: tender build ${dir}`);
  });

program.parseAsync(process.argv);
