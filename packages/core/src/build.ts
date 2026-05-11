import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { loadProjectRegistry } from "./parse/load-project-registry.js";
import { parseProject } from "./parse/project-parser.js";
import { composeDocument } from "./compose/document.js";
import { generateProjectCss } from "./compose/project-css.js";
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
  const md = await readFile(join(projectDir, docFilename), "utf8").catch(() => {
    throw new Error(`No document "${docBasename}" (looked for ${docFilename}) in ${projectDir}`);
  });
  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
  const { html: parsed, startsWithPage } = await parseProject(md, mergedConfig);
  const bodyHtml = startsWithPage ? parsed : `<div class="page">${parsed}</div>`;
  const lang = mergedConfig.typography?.lang ?? "en";
  const html = composeDocument({ bodyHtml, lang, title: basename(projectDir) });
  const projectCss = generateProjectCss(mergedConfig, { docTitle: basename(projectDir) });
  const timeoutMs = mergedConfig.render?.["timeout-ms"];
  return {
    html,
    projectCss,
    componentsCss: registry.combinedCss,
    stylesCss,
    config: mergedConfig,
    projectDir,
    docBasename,
    docFilename,
    timeoutMs
  };
}

function normaliseDocName(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}
