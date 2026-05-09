import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectRegistry } from "./load-project-registry.js";

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-projreg-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

const minimalYaml = "page-templates: { default: { size: A5, margin: 0 } }\n";

describe("loadProjectRegistry", () => {
  it("returns an empty registry when neither pathway has components", async () => {
    const dir = await fixture({ "project.yaml": minimalYaml });
    try {
      const { registry } = await loadProjectRegistry(dir);
      expect(registry.byName.size).toBe(0);
      expect(registry.combinedCss).toBe("");
      expect(registry.diagnostics).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads .tender components from components/ when there's no yaml registry", async () => {
    const dir = await fixture({
      "project.yaml": minimalYaml,
      "components/callout.tender": "---\ntag: aside\n---\n"
    });
    try {
      const { registry } = await loadProjectRegistry(dir);
      expect(registry.byName.size).toBe(1);
      expect(registry.byName.get("callout")?.def.tag).toBe("aside");
      expect(registry.diagnostics).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls through to yaml components when components/ is missing", async () => {
    const dir = await fixture({
      "project.yaml": [
        minimalYaml,
        "components:",
        "  callout:",
        "    tag: aside",
        "    class: callout"
      ].join("\n")
    });
    try {
      const { registry } = await loadProjectRegistry(dir);
      expect(registry.byName.size).toBe(1);
      expect(registry.byName.get("callout")?.def.tag).toBe("aside");
      // YAML-only project: every yaml entry is a deprecation warning.
      expect(registry.diagnostics.length).toBe(1);
      expect(registry.diagnostics[0]?.severity).toBe("warning");
      expect(registry.diagnostics[0]?.message).toMatch(/deprecated/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it(".tender takes precedence over yaml on name collision", async () => {
    const dir = await fixture({
      "project.yaml": [
        minimalYaml,
        "components:",
        "  callout:",
        "    tag: section",
        "    class: yaml-version"
      ].join("\n"),
      "components/callout.tender": "---\ntag: aside\nclass: tender-version\n---\n"
    });
    try {
      const { registry } = await loadProjectRegistry(dir);
      expect(registry.byName.size).toBe(1);
      expect(registry.byName.get("callout")?.def.tag).toBe("aside");
      expect(registry.byName.get("callout")?.def.class).toBe("tender-version");
      // Diagnostic about the shadowed yaml entry.
      expect(registry.diagnostics.some(d => /defined in both/.test(d.message))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("merges non-colliding yaml and .tender entries", async () => {
    const dir = await fixture({
      "project.yaml": [
        minimalYaml,
        "components:",
        "  yaml-only:",
        "    tag: span",
        "    class: yo"
      ].join("\n"),
      "components/tender-only.tender": "---\ntag: aside\n---\n"
    });
    try {
      const { registry } = await loadProjectRegistry(dir);
      expect(registry.byName.size).toBe(2);
      expect(registry.byName.has("yaml-only")).toBe(true);
      expect(registry.byName.has("tender-only")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exposes config from project.yaml", async () => {
    const dir = await fixture({
      "project.yaml": [
        "page-templates:",
        "  default: { size: A5, margin: 0 }",
        "  cover: { size: A4, margin: 0 }"
      ].join("\n")
    });
    try {
      const { config } = await loadProjectRegistry(dir);
      expect(config["page-templates"].default!.size).toBe("A5");
      expect(config["page-templates"].cover!.size).toBe("A4");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("propagates combinedCss from .tender files", async () => {
    const dir = await fixture({
      "project.yaml": minimalYaml,
      "components/widget.tender": [
        "---", "tag: div", "---", "",
        "<style>", ".widget { color: red; }", "</style>"
      ].join("\n")
    });
    try {
      const { registry } = await loadProjectRegistry(dir);
      expect(registry.combinedCss).toContain(".widget { color: red; }");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
