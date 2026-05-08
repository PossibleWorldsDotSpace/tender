import { describe, it, expect } from "vitest";
import { init } from "./init.js";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("init command", () => {
  it("scaffolds a project with project.yaml, styles.css, and content.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      await init(dir);
      const files = await readdir(dir);
      expect(files).toContain("project.yaml");
      expect(files).toContain("styles.css");
      expect(files).toContain("content.md");
      const yaml = await readFile(join(dir, "project.yaml"), "utf8");
      expect(yaml).toContain("page-templates");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a non-empty directory unless --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dir, "existing.txt"), "hi");
      await expect(init(dir)).rejects.toThrow(/not empty/i);
      await init(dir, { force: true });
      const yaml = await readFile(join(dir, "project.yaml"), "utf8");
      expect(yaml).toContain("page-templates");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
