import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectIndex } from "./project-index.js";

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-lsp-idx-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

const minimalYaml = "page-templates: { default: { size: A5, margin: 0 } }\n";

describe("loadProjectIndex", () => {
  it("returns an empty index for a project without components", async () => {
    const dir = await fixture({ "project.yaml": minimalYaml });
    try {
      const idx = await loadProjectIndex(dir);
      expect(idx.componentByName.size).toBe(0);
      expect(idx.projectDiagnostics).toEqual([]);
      expect(idx.pageTemplateByName.has("default")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("populates componentByName from .tender files", async () => {
    const dir = await fixture({
      "project.yaml": minimalYaml,
      "components/callout.tender": [
        "---",
        "tag: aside",
        "class: callout",
        "params: [variant]",
        "---",
        ""
      ].join("\n"),
      "components/row.tender": [
        "---",
        "params: [label]",
        "---",
        "",
        '<div class="row">{{{body}}}</div>'
      ].join("\n")
    });
    try {
      const idx = await loadProjectIndex(dir);
      expect(idx.componentByName.size).toBe(2);
      const callout = idx.componentByName.get("callout")!;
      expect(callout.isWrapper).toBe(true);
      expect(callout.params).toEqual(["variant"]);
      expect(callout.inline).toBe(false);
      const row = idx.componentByName.get("row")!;
      expect(row.isWrapper).toBe(false);
      expect(row.templateBody).toContain("{{{body}}}");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("captures inline:true components", async () => {
    const dir = await fixture({
      "project.yaml": minimalYaml,
      "components/sd.tender": "---\ntag: span\nclass: sd\ninline: true\n---\n"
    });
    try {
      const idx = await loadProjectIndex(dir);
      expect(idx.componentByName.get("sd")?.inline).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("populates pageTemplateByName from project.yaml", async () => {
    const dir = await fixture({
      "project.yaml": [
        "page-templates:",
        "  default: { size: A5, margin: 0 }",
        "  cover: { size: A4, margin: 0 }",
        "  chapter-opener: { size: A5, margin: 0 }"
      ].join("\n")
    });
    try {
      const idx = await loadProjectIndex(dir);
      expect([...idx.pageTemplateByName.keys()].sort()).toEqual([
        "chapter-opener", "cover", "default"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("collects project diagnostics on malformed project.yaml", async () => {
    const dir = await fixture({
      "project.yaml": "page-templates: { other: { size: A5, margin: 0 } }\n"
    });
    try {
      const idx = await loadProjectIndex(dir);
      // Missing `default` page template — schema-level error.
      expect(idx.projectDiagnostics.length).toBeGreaterThan(0);
      expect(idx.projectDiagnostics[0]?.severity).toBe("error");
      // The index still returns successfully with empty maps.
      expect(idx.componentByName.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forwards registry deprecation diagnostics", async () => {
    const dir = await fixture({
      "project.yaml": [
        minimalYaml,
        "components:",
        "  callout: { tag: aside, class: callout }"
      ].join("\n")
    });
    try {
      const idx = await loadProjectIndex(dir);
      // YAML-defined component triggers a deprecation diagnostic, but the
      // component is still indexed.
      expect(idx.componentByName.has("callout")).toBe(true);
      expect(idx.projectDiagnostics.some(d => d.severity === "warning")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("inlineShortcuts is empty in PR 3.1 (placeholder for design plan item 6)", async () => {
    const dir = await fixture({ "project.yaml": minimalYaml });
    try {
      const idx = await loadProjectIndex(dir);
      expect(idx.inlineShortcuts.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
