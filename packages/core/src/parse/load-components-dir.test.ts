import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadComponentsDir } from "./load-components-dir.js";

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-loadcomp-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

describe("loadComponentsDir", () => {
  it("returns an empty registry when components/ is missing", async () => {
    const dir = await fixture({ "project.yaml": "page-templates: { default: { size: A5, margin: 0 } }\n" });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.size).toBe(0);
      expect(reg.combinedCss).toBe("");
      expect(reg.diagnostics).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty registry when components/ exists but is empty", async () => {
    const dir = await fixture({ "components/.gitkeep": "" });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.size).toBe(0);
      expect(reg.combinedCss).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads a single wrapper-style component from a .tender file", async () => {
    const dir = await fixture({
      "components/callout.tender": [
        "---",
        "tag: aside",
        "class: callout",
        "params: [variant]",
        "---",
        ""
      ].join("\n")
    });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.size).toBe(1);
      const entry = reg.byName.get("callout")!;
      expect(entry.def.tag).toBe("aside");
      expect(entry.def.class).toBe("callout");
      expect(entry.def.params).toEqual(["variant"]);
      expect(entry.def.template).toBeUndefined();
      expect(entry.source.path.endsWith("callout.tender")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads a block-template component from a .tender file", async () => {
    const dir = await fixture({
      "components/row.tender": [
        "---",
        "params: [label]",
        "---",
        "",
        '<div class="row"><span>{{label}}</span><div>{{{body}}}</div></div>'
      ].join("\n")
    });
    try {
      const reg = await loadComponentsDir(dir);
      const entry = reg.byName.get("row")!;
      expect(entry.def.params).toEqual(["label"]);
      expect(entry.def.template).toContain("{{{body}}}");
      expect(entry.def.tag).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("concatenates <style> blocks in alphabetical-by-name order", async () => {
    const dir = await fixture({
      "components/zebra.tender": [
        "---", "tag: span", "---", "",
        "<style>", ".zebra { color: black; }", "</style>"
      ].join("\n"),
      "components/alpha.tender": [
        "---", "tag: span", "---", "",
        "<style>", ".alpha { color: red; }", "</style>"
      ].join("\n"),
      "components/middle.tender": [
        "---", "tag: span", "---", "",
        "<style>", ".middle { color: blue; }", "</style>"
      ].join("\n")
    });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.size).toBe(3);
      // Alphabetical: alpha, middle, zebra
      const alphaIdx = reg.combinedCss.indexOf(".alpha");
      const middleIdx = reg.combinedCss.indexOf(".middle");
      const zebraIdx = reg.combinedCss.indexOf(".zebra");
      expect(alphaIdx).toBeGreaterThanOrEqual(0);
      expect(middleIdx).toBeGreaterThan(alphaIdx);
      expect(zebraIdx).toBeGreaterThan(middleIdx);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits components without <style> blocks from combinedCss", async () => {
    const dir = await fixture({
      "components/with-css.tender": [
        "---", "tag: span", "---", "",
        "<style>", ".x { color: red; }", "</style>"
      ].join("\n"),
      "components/without-css.tender": [
        "---", "tag: aside", "---", ""
      ].join("\n")
    });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.size).toBe(2);
      expect(reg.combinedCss).toContain(".x");
      // No stray newlines or empty entries — only the one declaring component
      // contributes.
      expect(reg.combinedCss.split("\n").filter(l => l.trim()).length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recurses into subdirectories of components/", async () => {
    const dir = await fixture({
      "components/inline/sc.tender": [
        "---", "tag: span", "class: sc", "inline: true", "---", ""
      ].join("\n"),
      "components/block/row.tender": [
        "---", "tag: div", "class: row", "---", ""
      ].join("\n")
    });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.has("sc")).toBe(true);
      expect(reg.byName.has("row")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hard-errors on a name collision between two .tender files", async () => {
    const dir = await fixture({
      "components/row.tender": "---\ntag: div\n---\n",
      "components/nested/row.tender": "---\ntag: section\n---\n"
    });
    try {
      await expect(loadComponentsDir(dir)).rejects.toThrow(/Duplicate component name "row"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("propagates parser errors with the file path", async () => {
    const dir = await fixture({
      "components/broken.tender": "---\nfoo: [unclosed\n---\n"
    });
    try {
      await expect(loadComponentsDir(dir)).rejects.toThrow(/broken\.tender/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a component that declares neither tag nor template", async () => {
    const dir = await fixture({
      "components/empty.tender": "---\nparams: [x]\n---\n"
    });
    try {
      await expect(loadComponentsDir(dir)).rejects.toThrow(/either `tag`.*or `template`/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a component that declares both tag and template", async () => {
    const dir = await fixture({
      "components/both.tender": [
        "---",
        "tag: div",
        "---",
        "",
        "<div>{{{body}}}</div>"
      ].join("\n")
    });
    try {
      await expect(loadComponentsDir(dir)).rejects.toThrow(/cannot declare both/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats legacy `attrs:` frontmatter as `params:`", async () => {
    const dir = await fixture({
      "components/callout.tender": [
        "---",
        "tag: aside",
        "attrs: [variant]",
        "---",
        ""
      ].join("\n")
    });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.get("callout")!.def.params).toEqual(["variant"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("attaches the file path to source for definition-jump lookups", async () => {
    const dir = await fixture({
      "components/sub/widget.tender": "---\ntag: div\n---\n"
    });
    try {
      const reg = await loadComponentsDir(dir);
      const entry = reg.byName.get("widget")!;
      expect(entry.source.path).toContain(join("components", "sub", "widget.tender"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces a palette block parsed from <palette> as Component.palette", async () => {
    const dir = await fixture({
      "components/callout.tender": [
        "---",
        "tag: aside",
        "params: [variant]",
        "---",
        "",
        "<palette>",
        "attrs: { variant: warning }",
        "body: \"Watch out.\"",
        "</palette>"
      ].join("\n")
    });
    try {
      const reg = await loadComponentsDir(dir);
      const entry = reg.byName.get("callout")!;
      expect(entry.def.palette?.attrs?.variant).toBe("warning");
      expect(entry.def.palette?.body).toBe("Watch out.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores files that are not .tender", async () => {
    const dir = await fixture({
      "components/widget.tender": "---\ntag: div\n---\n",
      "components/README.md": "# notes\n",
      "components/styles.css": ".x {}\n"
    });
    try {
      const reg = await loadComponentsDir(dir);
      expect(reg.byName.size).toBe(1);
      expect(reg.byName.has("widget")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
