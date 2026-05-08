import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { ProjectConfig } from "./schema.js";

export async function loadProjectConfig(projectDir: string): Promise<ProjectConfig> {
  const path = join(projectDir, "project.yaml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`project.yaml not found at ${path}`);
    }
    throw err;
  }
  const data = parseYaml(raw);
  return ProjectConfig.parse(data);
}
