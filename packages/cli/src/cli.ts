#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { build } from "./commands/build.js";
import { lint } from "./commands/lint.js";

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

program.parseAsync(process.argv);
