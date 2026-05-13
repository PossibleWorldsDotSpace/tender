import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { loadProjectRegistry } from "./parse/load-project-registry.js";
import { listDocuments } from "./parse/list-documents.js";
import { parseProject } from "./parse/project-parser.js";
import { composeDocument } from "./compose/document.js";
import { generateProjectCss, pageSizeToWidthHeight } from "./compose/project-css.js";
import type { ProjectConfig } from "./config/schema.js";

export interface BuildResult {
  html: string;
  projectCss: string;
  /** Concatenated <style> blocks from every .tender component, alphabetical-by-name. */
  componentsCss: string;
  stylesCss: string;
  config: ProjectConfig;
  projectDir: string;
  /** Basename without extension, e.g. "resume" or "content". */
  docBasename: string;
  /** Filename, e.g. "resume.md". */
  docFilename: string;
  /** Carried through from project.yaml's `render.timeout-ms`, if set. */
  timeoutMs?: number;
  /**
   * Page-box dimensions for this document, as CSS-dimension strings (e.g.
   * "210mm", "297mm"), resolved from the `default` page template's `size`.
   * The renderer hands these straight to Chromium's `page.pdf()` — Paged.js
   * consumes the `@page { size }` rule into its own `--pagedjs-*` properties,
   * so `preferCSSPageSize` no longer sees a size to honour and the PDF would
   * otherwise come out at Chromium's Letter default.
   *
   * Multi-template projects: a single PDF has one page size, so we use the
   * `default` template (always present per the schema). A document that mixes
   * templates of different sizes still gets one size here.
   */
  pageWidth: string;
  pageHeight: string;
}

export interface BuildProjectOptions {
  /** Doc basename or filename (with or without .md). Defaults to "content". */
  docName?: string;
}

export async function buildProject(
  projectDir: string,
  opts: BuildProjectOptions = {}
): Promise<BuildResult> {
  const { config, registry } = await loadProjectRegistry(projectDir);

  // The parser consumes ProjectConfig; the registry replaces (or augments)
  // its `components` field with whatever loadProjectRegistry resolved.
  const mergedComponents: Record<string, NonNullable<ProjectConfig["components"]>[string]> = {};
  for (const [name, entry] of registry.byName) {
    mergedComponents[name] = entry.def;
  }
  const mergedConfig: ProjectConfig = { ...config, components: mergedComponents };

  const docBasename = normaliseDocName(opts.docName ?? "content");
  const docFilename = `${docBasename}.md`;
  const md = await readFile(join(projectDir, docFilename), "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") {
      throw new Error(`No document "${docBasename}" (looked for ${docFilename}) in ${projectDir}`);
    }
    throw err;
  });
  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
  const { html: parsed, startsWithPage } = await parseProject(md, mergedConfig, { docFilename });
  const bodyHtml = startsWithPage ? parsed : `<div class="page">${parsed}</div>`;
  const lang = mergedConfig.typography?.lang ?? "en";
  const html = composeDocument({ bodyHtml, lang, title: basename(projectDir) });
  const projectCss = generateProjectCss(mergedConfig, { docTitle: basename(projectDir) });
  const timeoutMs = mergedConfig.render?.["timeout-ms"];
  const [pageWidth, pageHeight] = pageSizeToWidthHeight(mergedConfig["page-templates"].default!.size);
  return {
    html,
    projectCss,
    componentsCss: registry.combinedCss,
    stylesCss,
    config: mergedConfig,
    projectDir,
    docBasename,
    docFilename,
    timeoutMs,
    pageWidth,
    pageHeight
  };
}

function normaliseDocName(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

/**
 * Build every document at the project root. Returns one BuildResult per
 * *.md file at the root, in `listDocuments` order (content.md first if
 * present, then alphabetical). Returns [] when the project has no docs.
 *
 * Implementation note: this runs `buildProject` serially per doc. Each
 * call re-loads the project registry from disk, which is wasted work
 * for multi-doc projects. The optimisation (load registry once, thread
 * it through `buildProject`) would touch `buildProject`'s signature and
 * is deferred — see Task 5 notes. The fan-out is small in practice
 * (a handful of docs per project) and concurrent disk I/O would
 * compete anyway, so a serial loop is fine for now.
 */
export async function buildProjectAll(projectDir: string): Promise<BuildResult[]> {
  const docs = await listDocuments(projectDir);
  const results: BuildResult[] = [];
  for (const d of docs) {
    results.push(await buildProject(projectDir, { docName: d.basename }));
  }
  return results;
}
