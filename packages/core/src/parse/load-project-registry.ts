import { loadProjectConfig } from "../config/load.js";
import { loadComponentsDir } from "./load-components-dir.js";
import type { ProjectConfig } from "../config/schema.js";
import type { ComponentRegistry, Diagnostic } from "./load-components-dir.js";
import { join } from "node:path";

export interface ProjectRegistry {
  /** Validated project.yaml contents (page-templates, typography, fonts, render). */
  config: ProjectConfig;
  /** Merged component registry: .tender files first, then yaml entries that don't collide. */
  registry: ComponentRegistry;
}

/**
 * Single entry point for resolving "the components for this project."
 * Combines the YAML registry (legacy) with the filesystem registry (new):
 *
 * - `.tender` files in `components/` take precedence on name collision.
 * - YAML entries that don't collide are folded in with a deprecation
 *   diagnostic ("move to components/${name}.tender").
 * - The shadowed YAML entries also get a deprecation diagnostic but don't
 *   contribute to the registry — the `.tender` file owns the name.
 *
 * A project that uses neither path simply gets an empty registry; downstream
 * code receives an empty `byName` map and an empty `combinedCss` string.
 */
export async function loadProjectRegistry(projectDir: string): Promise<ProjectRegistry> {
  const config = await loadProjectConfig(projectDir);
  const tender = await loadComponentsDir(projectDir);

  const yamlComponents = config.components ?? {};
  const yamlPath = join(projectDir, "project.yaml");
  const diagnostics: Diagnostic[] = [...tender.diagnostics];

  for (const [name, def] of Object.entries(yamlComponents)) {
    if (!def) continue;
    if (tender.byName.has(name)) {
      diagnostics.push({
        severity: "warning",
        message: `Component "${name}" defined in both project.yaml and components/${name}.tender; the .tender file wins.`,
        source: { path: yamlPath }
      });
      continue;
    }
    diagnostics.push({
      severity: "warning",
      message: `Component "${name}" defined in project.yaml is deprecated; move to components/${name}.tender.`,
      source: { path: yamlPath }
    });
    tender.byName.set(name, { def, source: { path: yamlPath } });
  }

  // Validate inline-shortcuts (item 6): each declared character maps to a
  // component that exists and is inline:true. Invalid declarations fold into
  // diagnostics; the build continues and produces output without expanding
  // the bad shortcut.
  const shortcuts = config["inline-shortcuts"] ?? {};
  for (const [char, name] of Object.entries(shortcuts)) {
    const entry = tender.byName.get(name);
    if (!entry) {
      diagnostics.push({
        severity: "error",
        message: `inline-shortcut "${char}" maps to unknown component "${name}"`,
        source: { path: yamlPath }
      });
      continue;
    }
    if (!entry.def.inline) {
      diagnostics.push({
        severity: "error",
        message: `inline-shortcut "${char}" maps to non-inline component "${name}"; component must declare \`inline: true\``,
        source: { path: yamlPath }
      });
    }
  }

  const registry: ComponentRegistry = {
    byName: tender.byName,
    combinedCss: tender.combinedCss,
    diagnostics
  };

  return { config, registry };
}
