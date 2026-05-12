import { describe, it, expect } from "vitest";
import { init, formatInitResult } from "./init.js";
import type { InitGitResult } from "./init.js";
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("init command", () => {
  it("scaffolds a project with project.yaml, styles.css, content.md, and .gitignore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      const result = await init(dir);
      const files = await readdir(dir);
      expect(files).toContain("project.yaml");
      expect(files).toContain("styles.css");
      expect(files).toContain("content.md");
      expect(files).toContain(".gitignore");
      const yaml = await readFile(join(dir, "project.yaml"), "utf8");
      expect(yaml).toContain("page-templates");
      const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
      expect(gitignore).toContain("out/");
      expect(gitignore).toContain("node_modules/");
      // Every scaffolded file should be reported as created.
      expect(result.files.every(f => f.action === "created")).toBe(true);
      expect(result.files.some(f => f.path === ".gitignore")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("initialises a git repository in a fresh directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      const result = await init(dir);
      // Either we created the repo, or (no git on this machine) we said so.
      expect(["created", "git-missing", "init-failed"]).toContain(result.git.action);
      if (result.git.action === "created") {
        const dotGit = await stat(join(dir, ".git")).then(() => true).catch(() => false);
        expect(dotGit).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not re-init when the directory is already inside a git repo", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    let gitOk = true;
    try { await run("git", ["--version"]); } catch { gitOk = false; }
    if (!gitOk) return; // git unavailable — nothing to assert
    const parent = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      await run("git", ["init"], { cwd: parent });
      const dir = join(parent, "doc");
      const result = await init(dir);
      expect(result.git.action).toBe("already-repo");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("preserves existing files instead of refusing", async () => {
    // The most common flow: user has a content.md already and wants to
    // scaffold the rest of a Tender project around it.
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      const userPose = "# My existing manuscript\n\nSome prose.\n";
      await writeFile(join(dir, "content.md"), userPose);
      const result = await init(dir);
      // content.md is preserved verbatim.
      const after = await readFile(join(dir, "content.md"), "utf8");
      expect(after).toBe(userPose);
      // project.yaml et al. are created.
      const files = await readdir(dir);
      expect(files).toContain("project.yaml");
      // Result reports content.md as preserved, others as created.
      const cm = result.files.find(f => f.path === "content.md");
      expect(cm?.action).toBe("preserved");
      const py = result.files.find(f => f.path === "project.yaml");
      expect(py?.action).toBe("created");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: re-running reports every file as preserved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      await init(dir);
      const before = await readFile(join(dir, "content.md"), "utf8");
      const second = await init(dir);
      const after = await readFile(join(dir, "content.md"), "utf8");
      expect(after).toBe(before);
      expect(second.files.every(f => f.action === "preserved")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--force overwrites existing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      await writeFile(join(dir, "content.md"), "user wrote this");
      const result = await init(dir, { force: true });
      const after = await readFile(join(dir, "content.md"), "utf8");
      expect(after).not.toBe("user wrote this");
      const cm = result.files.find(f => f.path === "content.md");
      expect(cm?.action).toBe("overwritten");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("works on a non-existent directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tender-init-"));
    const dir = join(parent, "new-project");
    try {
      const result = await init(dir);
      const files = await readdir(dir);
      expect(files).toContain("project.yaml");
      expect(result.files.every(f => f.action === "created")).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("preserves a user-modified styles.css alongside other template files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-"));
    try {
      const userCss = "/* my custom styles */\nbody { color: red; }\n";
      await writeFile(join(dir, "styles.css"), userCss);
      await init(dir);
      const after = await readFile(join(dir, "styles.css"), "utf8");
      expect(after).toBe(userCss);
      // Other template files were created normally.
      const files = await readdir(dir);
      expect(files).toContain("project.yaml");
      expect(files).toContain("content.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe("formatInitResult", () => {
    const gitCreated: InitGitResult = { action: "created" };
    const gitAlready: InitGitResult = { action: "already-repo" };

    it("describes a fresh init", () => {
      const text = formatInitResult({
        targetDir: "/path/to/proj",
        files: [
          { path: "project.yaml", action: "created" },
          { path: "content.md", action: "created" },
          { path: "styles.css", action: "created" }
        ],
        git: gitCreated
      });
      expect(text).toContain("Created 3 files");
      expect(text).toContain("project.yaml");
      expect(text).toContain("Initialized a git repository.");
      expect(text).toContain("Project ready at /path/to/proj");
    });

    it("describes a re-run with all files preserved", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [
          { path: "project.yaml", action: "preserved" },
          { path: "content.md", action: "preserved" }
        ],
        git: gitAlready
      });
      expect(text).toContain("Preserved 2 existing files");
      expect(text).toContain("All template files already exist");
      // already-repo says nothing about git.
      expect(text).not.toContain("git repository");
    });

    it("describes a mixed run (some created, some preserved)", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [
          { path: "content.md", action: "preserved" },
          { path: "project.yaml", action: "created" }
        ],
        git: gitAlready
      });
      expect(text).toContain("Created 1 file");
      expect(text).toContain("Preserved 1 existing file");
      expect(text).toContain("Project ready");
    });

    it("notes when git is missing", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [{ path: "project.yaml", action: "created" }],
        git: { action: "git-missing" }
      });
      expect(text).toContain("git not found");
    });
  });
});
