#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { build } from "./commands/build.js";

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

program.parseAsync(process.argv);
