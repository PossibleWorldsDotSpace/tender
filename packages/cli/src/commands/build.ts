import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildProject } from "@tender/core";
import { renderHtml, renderPdf } from "@tender/render";

export interface BuildOptions {
  projectDir: string;
  outDir: string;
  pdfOnly?: boolean;
  htmlOnly?: boolean;
}

export async function build(opts: BuildOptions): Promise<void> {
  const result = await buildProject(opts.projectDir);
  await mkdir(opts.outDir, { recursive: true });
  if (!opts.pdfOnly) {
    const html = await renderHtml(result);
    await writeFile(join(opts.outDir, "document.html"), html);
  }
  if (!opts.htmlOnly) {
    const pdf = await renderPdf(result);
    await writeFile(join(opts.outDir, "document.pdf"), pdf);
  }
}
