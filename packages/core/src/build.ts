import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { loadProjectConfig } from "./config/load.js";
import { parseProject } from "./parse/project-parser.js";
import { composeDocument } from "./compose/document.js";
import { generateProjectCss } from "./compose/project-css.js";
import type { ProjectConfig } from "./config/schema.js";

export interface BuildResult {
  html: string;
  projectCss: string;
  stylesCss: string;
  config: ProjectConfig;
  projectDir: string;
  /** Carried through from project.yaml's `render.timeout-ms`, if set. */
  timeoutMs?: number;
}

export async function buildProject(projectDir: string): Promise<BuildResult> {
  const config = await loadProjectConfig(projectDir);
  const md = await readFile(join(projectDir, "content.md"), "utf8");
  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
  const { html: parsed, startsWithPage } = await parseProject(md, config);
  const bodyHtml = startsWithPage ? parsed : `<div class="page">${parsed}</div>`;
  const lang = config.typography?.lang ?? "en";
  const html = composeDocument({ bodyHtml, lang, title: basename(projectDir) });
  const projectCss = generateProjectCss(config, { docTitle: basename(projectDir) });
  const timeoutMs = config.render?.["timeout-ms"];
  return { html, projectCss, stylesCss, config, projectDir, timeoutMs };
}
