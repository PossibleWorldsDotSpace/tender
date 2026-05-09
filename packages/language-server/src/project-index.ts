import { loadProjectRegistry } from "@tender/core";
import type { ProjectConfig } from "@tender/core";

/**
 * Stateful core of the language server: a snapshot of the project's
 * components, page templates, and inline shortcuts derived from filesystem
 * state. Providers (completion, hover, diagnostics, definition) read from
 * this snapshot; the file watcher mutates it on disk changes.
 *
 * In PR 3.1 the index is populated by reusing `loadProjectRegistry` from
 * `@tender/core`, with errors caught and folded into `projectDiagnostics`.
 * That's a serviceable skeleton: the schemas and registry semantics are
 * exactly right, and the editor stays useful when the project compiles.
 * It is **not** the final shape — `loadProjectRegistry` throws on the first
 * bad component, which is the wrong behavior mid-keystroke. PR 3.2 swaps
 * it for recovery-oriented parsers that always produce partial results
 * with per-file diagnostics.
 */
export interface ProjectIndex {
  /** Path to the project root (the directory containing project.yaml). */
  projectDir: string;
  /** Components keyed by name; includes built-ins and user-declared. */
  componentByName: Map<string, ComponentSymbol>;
  /** Page templates keyed by name (from project.yaml's `page-templates:`). */
  pageTemplateByName: Map<string, PageTemplateSymbol>;
  /**
   * Inline shortcuts: single-character bindings (e.g. "@") mapped to a
   * registered component name. Reserved for the design plan's item 6;
   * always empty in PR 3.1.
   */
  inlineShortcuts: Map<string, string>;
  /**
   * Diagnostics about the project state itself — malformed project.yaml,
   * unparseable .tender files, etc. Per-file diagnostics for `content.md`
   * are computed by the diagnostics provider, not the index.
   */
  projectDiagnostics: ProjectDiagnostic[];
}

export interface ComponentSymbol {
  name: string;
  /** Source path of the definition (a .tender file or project.yaml). */
  path: string;
  inline: boolean;
  params: readonly string[];
  slots: readonly string[];
  /** Handlebars template body, if the component is a block template. */
  templateBody?: string;
  /** True when the component is a wrapper (no `template`). */
  isWrapper: boolean;
}

export interface PageTemplateSymbol {
  name: string;
  /** project.yaml — every page template lives there for now. */
  path: string;
}

export interface ProjectDiagnostic {
  severity: "error" | "warning";
  message: string;
  /** File the diagnostic applies to; absent diagnostics target the project. */
  path?: string;
}

/**
 * Build a ProjectIndex from the on-disk state of `projectDir`. Always
 * returns a valid index — never throws. Errors loading project.yaml or
 * a .tender file produce diagnostics on the returned index.
 */
export async function loadProjectIndex(projectDir: string): Promise<ProjectIndex> {
  const componentByName = new Map<string, ComponentSymbol>();
  const pageTemplateByName = new Map<string, PageTemplateSymbol>();
  const projectDiagnostics: ProjectDiagnostic[] = [];

  let registry: Awaited<ReturnType<typeof loadProjectRegistry>> | undefined;
  try {
    registry = await loadProjectRegistry(projectDir);
  } catch (err) {
    projectDiagnostics.push({
      severity: "error",
      message: err instanceof Error ? err.message : String(err)
    });
  }

  if (registry) {
    for (const entry of registry.registry.diagnostics) {
      projectDiagnostics.push({
        severity: entry.severity,
        message: entry.message,
        path: entry.source?.path
      });
    }
    for (const [name, e] of registry.registry.byName) {
      componentByName.set(name, toComponentSymbol(name, e.def, e.source.path));
    }
    populatePageTemplates(registry.config, projectDir, pageTemplateByName);
  }

  return {
    projectDir,
    componentByName,
    pageTemplateByName,
    inlineShortcuts: new Map(),
    projectDiagnostics
  };
}

function toComponentSymbol(
  name: string,
  def: NonNullable<ProjectConfig["components"]>[string],
  path: string
): ComponentSymbol {
  return {
    name,
    path,
    inline: def.inline ?? false,
    params: def.params ?? [],
    slots: def.slots ?? [],
    templateBody: def.template,
    isWrapper: def.template === undefined
  };
}

function populatePageTemplates(
  config: ProjectConfig,
  projectDir: string,
  out: Map<string, PageTemplateSymbol>
) {
  // The PageTemplate schema has `default` plus any number of named entries.
  // All live under project.yaml; the path is the same for each.
  const path = `${projectDir}/project.yaml`;
  for (const name of Object.keys(config["page-templates"])) {
    out.set(name, { name, path });
  }
}
