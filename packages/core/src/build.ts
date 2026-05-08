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
}

export async function buildProject(projectDir: string): Promise<BuildResult> {
  const config = await loadProjectConfig(projectDir);
  const md = await readFile(join(projectDir, "content.md"), "utf8");
  const stylesCss = await readFile(join(projectDir, "styles.css"), "utf8").catch(() => "");
  const bodyHtml = `<div class="page">${await parseProject(md, config)}</div>`;
  const html = composeDocument({ bodyHtml, lang: "en", title: basename(projectDir) });
  const projectCss = generateProjectCss(config, { docTitle: basename(projectDir) });
  return { html, projectCss, stylesCss, config, projectDir };
}
