import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadProjectConfig } from "./load.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../test/fixtures");

describe("loadProjectConfig", () => {
  it("loads and validates a minimal project.yaml", async () => {
    const config = await loadProjectConfig(join(fixturesDir, "minimal"));
    expect(config["page-templates"].default!.size).toBe("A5");
  });

  it("throws a helpful error when project.yaml is missing", async () => {
    await expect(loadProjectConfig(join(fixturesDir, "does-not-exist")))
      .rejects.toThrow(/project\.yaml/);
  });

  it("folds a legacy `templates:` block into `components:`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-legacy-"));
    try {
      await writeFile(
        join(dir, "project.yaml"),
        [
          "page-templates: { default: { size: A5, margin: 0 } }",
          "templates:",
          "  row:",
          "    params: [label]",
          "    template: '<div class=\"row\">{{{body}}}</div>'"
        ].join("\n")
      );
      const config = await loadProjectConfig(dir);
      expect(config.components?.row?.template).toContain("{{{body}}}");
      // Sanity: no `templates` key on the merged config (it's been removed).
      expect((config as unknown as { templates?: unknown }).templates).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renames legacy `attrs:` to `params:` on wrapper components", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-legacy-"));
    try {
      await writeFile(
        join(dir, "project.yaml"),
        [
          "page-templates: { default: { size: A5, margin: 0 } }",
          "components:",
          "  callout:",
          "    tag: aside",
          "    class: callout",
          "    attrs: [variant]"
        ].join("\n")
      );
      const config = await loadProjectConfig(dir);
      expect(config.components?.callout?.params).toEqual(["variant"]);
      expect((config.components?.callout as unknown as { attrs?: unknown }).attrs).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("explicit `components:` entry wins on collision with legacy `templates:`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-legacy-"));
    try {
      await writeFile(
        join(dir, "project.yaml"),
        [
          "page-templates: { default: { size: A5, margin: 0 } }",
          "components:",
          "  row:",
          "    tag: div",
          "    class: kept",
          "templates:",
          "  row:",
          "    template: '<div class=\"discarded\">{{{body}}}</div>'"
        ].join("\n")
      );
      const config = await loadProjectConfig(dir);
      expect(config.components?.row?.tag).toBe("div");
      expect(config.components?.row?.class).toBe("kept");
      expect(config.components?.row?.template).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
