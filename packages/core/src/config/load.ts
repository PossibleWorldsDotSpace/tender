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
  return ProjectConfig.parse(applyLegacyComponentShape(data));
}

/**
 * Pre-validation migration of pre-unification YAML shapes:
 *
 * - `templates:` is folded into `components:` (every Handlebars template is
 *   just a component with a `template` body).
 * - On wrapper components, `attrs:` is renamed to `params:` (the merged schema
 *   uses one name for both forwarded `data-*` attributes and Handlebars params;
 *   the resolver picks the right behavior based on whether `template` is set).
 *
 * Both transformations are silent — adding a deprecation diagnostic surface is
 * a separate concern. They exist so authors don't need to rewrite their
 * `project.yaml` to upgrade.
 */
function applyLegacyComponentShape(data: unknown): unknown {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return data;
  const obj = { ...(data as Record<string, unknown>) };

  // Rename `attrs` → `params` on wrapper components.
  if (obj.components && typeof obj.components === "object" && !Array.isArray(obj.components)) {
    const comps = obj.components as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(comps)) {
      next[name] = renameAttrsToParams(def);
    }
    obj.components = next;
  }

  // Fold `templates:` into `components:`.
  if (obj.templates && typeof obj.templates === "object" && !Array.isArray(obj.templates)) {
    const templates = obj.templates as Record<string, unknown>;
    const components = (obj.components ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...components };
    for (const [name, def] of Object.entries(templates)) {
      // `.tender` files take precedence (PR 1.3 concern); within YAML, an
      // explicit components: entry wins on collision.
      if (!(name in merged)) merged[name] = def;
    }
    obj.components = merged;
    delete obj.templates;
  }
  return obj;
}

function renameAttrsToParams(def: unknown): unknown {
  if (def == null || typeof def !== "object" || Array.isArray(def)) return def;
  const d = { ...(def as Record<string, unknown>) };
  if ("attrs" in d && !("params" in d)) {
    d.params = d.attrs;
    delete d.attrs;
  }
  return d;
}
