import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildProject, buildProjectAll } from "@tender/core";
import { renderHtml, renderPdf } from "@tender/render";

export interface BuildOptions {
  projectDir: string;
  outDir: string;
  pdfOnly?: boolean;
  htmlOnly?: boolean;
  /** Doc basename or filename (with or without .md). Selects which document to build. */
  docName?: string;
  /** CLI override for render timeout. Wins over project.yaml's render.timeout-ms. */
  timeoutMs?: number;
}

export async function build(opts: BuildOptions): Promise<void> {
  await mkdir(opts.outDir, { recursive: true });
  const results = opts.docName
    ? [await buildProject(opts.projectDir, { docName: opts.docName })]
    : await buildProjectAll(opts.projectDir);

  if (results.length === 0) {
    throw new Error(`No documents found in ${opts.projectDir} (expected a *.md file at the project root).`);
  }

  for (const result of results) {
    // CLI override wins; otherwise inherit whatever buildProject pulled from project.yaml.
    const renderInput = opts.timeoutMs ? { ...result, timeoutMs: opts.timeoutMs } : result;
    const stem = result.docBasename;
    if (!opts.pdfOnly) {
      const html = await renderHtml(renderInput);
      await writeFile(join(opts.outDir, `${stem}.html`), html);
    }
    if (!opts.htmlOnly) {
      const pdf = await renderPdf(renderInput);
      await writeFile(join(opts.outDir, `${stem}.pdf`), pdf);
    }
  }
}
