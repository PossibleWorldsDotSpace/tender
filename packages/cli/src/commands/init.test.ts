import { describe, it, expect } from "vitest";
import { init, formatInitResult, formatInitRoundup, installSkill, formatSkillInstall, SKILL_PROJECT_PATH } from "./init.js";
import type { InitGitResult, InitResult } from "./init.js";
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Defaults for formatInitResult fixtures so each test states only what it asserts. */
const base: Pick<InitResult, "skill" | "trackOut"> = { skill: "skipped", trackOut: false };

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

  it("--example=open-circle scaffolds the worked example into an empty directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-ex-"));
    try {
      const result = await init(dir, { example: "open-circle" });
      expect(result.template).toBe("open-circle");
      expect(result.conflicts).toEqual([]);
      // Hallmarks of the open-circle example, not the minimal starter.
      const yaml = await readFile(join(dir, "project.yaml"), "utf8");
      expect(yaml).toContain("design-tokens");
      expect(yaml).toContain("font:");
      const components = await readdir(join(dir, "components"));
      expect(components).toContain("row.tender");
      expect(components).toContain("ad-lib.tender");
      const content = await readFile(join(dir, "content.md"), "utf8");
      expect(content).toContain("Open Circle");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--example refuses to overwrite existing files; reports conflicts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-ex-"));
    try {
      await writeFile(join(dir, "content.md"), "# Mine\n");
      const result = await init(dir, { example: "open-circle" });
      expect(result.files).toEqual([]);
      expect(result.conflicts).toContain("content.md");
      // The user's file is untouched.
      const after = await readFile(join(dir, "content.md"), "utf8");
      expect(after).toBe("# Mine\n");
      // project.yaml from the example wasn't written either.
      await expect(readFile(join(dir, "project.yaml"), "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--example --force overwrites conflicting files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-ex-"));
    try {
      await writeFile(join(dir, "content.md"), "# Mine\n");
      const result = await init(dir, { example: "open-circle", force: true });
      expect(result.conflicts).toEqual([]);
      const after = await readFile(join(dir, "content.md"), "utf8");
      expect(after).toContain("Open Circle");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--example=<unknown> throws a clear error listing the available names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-init-ex-"));
    try {
      await expect(init(dir, { example: "nope" as never })).rejects.toThrow(/unknown example.*open-circle/i);
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
        git: gitCreated,
        template: "default",
        conflicts: [],
        ...base
      });
      expect(text).toContain("Created 3 files");
      expect(text).toContain("project.yaml");
      expect(text).toContain("Initialized a git repository.");
    });

    it("describes a re-run with all files preserved", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [
          { path: "project.yaml", action: "preserved" },
          { path: "content.md", action: "preserved" }
        ],
        git: gitAlready,
        template: "default",
        conflicts: [],
        ...base
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
        git: gitAlready,
        template: "default",
        conflicts: [],
        ...base
      });
      expect(text).toContain("Created 1 file");
      expect(text).toContain("Preserved 1 existing file");
    });

    it("notes when git is missing", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [{ path: "project.yaml", action: "created" }],
        git: { action: "git-missing" },
        template: "default",
        conflicts: [],
        ...base
      });
      expect(text).toContain("git not found");
    });

    it("says nothing about git when the user opted out", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [{ path: "project.yaml", action: "created" }],
        git: { action: "skipped" },
        template: "default",
        conflicts: [],
        ...base
      });
      expect(text).not.toContain("git");
    });

    it("reports an installed skill and omits the recoverability tip", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [{ path: "project.yaml", action: "created" }],
        git: gitCreated,
        template: "default",
        conflicts: [],
        skill: "installed",
        trackOut: false
      });
      expect(text).toContain(`Installed the tender-author skill at ${SKILL_PROJECT_PATH}/`);
      expect(text).not.toContain("tender add-skill");
    });

    it("prints the recoverability tip when the skill was skipped", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [{ path: "project.yaml", action: "created" }],
        git: gitCreated,
        template: "default",
        conflicts: [],
        skill: "skipped",
        trackOut: false
      });
      expect(text).toContain("tender add-skill");
    });

    it("describes a refused example install with the conflicts list", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [],
        git: { action: "already-repo" },
        template: "open-circle",
        conflicts: ["content.md", "styles.css"],
        ...base
      });
      expect(text).toContain("Refused to install the \"open-circle\" example");
      expect(text).toContain("content.md");
      expect(text).toContain("styles.css");
      expect(text).toContain("--force");
    });

    it("describes a fresh example install", () => {
      const text = formatInitResult({
        targetDir: "/p",
        files: [{ path: "content.md", action: "created" }],
        git: { action: "created" },
        template: "open-circle",
        conflicts: [],
        ...base
      });
      expect(text).toContain("Loaded example: open-circle.");
    });
  });

  describe("formatInitRoundup", () => {
    const baseResult: Omit<Parameters<typeof formatInitRoundup>[0], never> = {
      targetDir: "/p",
      files: [{ path: "project.yaml", action: "created" }],
      git: { action: "created" },
      skill: "installed",
      template: "default",
      conflicts: [],
      trackOut: false
    };

    it("opens with a one-line 'project ready' headline and the next-step pointer", () => {
      const text = formatInitRoundup(baseResult);
      expect(text).toMatch(/^Your project is ready at \/p\.$/m);
      expect(text).toMatch(/Next: tender preview$/m);
    });

    it("summarises the scaffold (created count)", () => {
      const text = formatInitRoundup(baseResult);
      expect(text).toContain("Scaffold: 1 file created.");
    });

    it("includes git and skill status when both happened", () => {
      const text = formatInitRoundup(baseResult);
      expect(text).toContain("Git: initialized.");
      expect(text).toContain("Skill: tender-author installed.");
    });

    it("rolls up applied page-setup edits and the new-template hint", () => {
      const text = formatInitRoundup(baseResult, {
        page: { outcome: "applied", editCount: 3, addedTemplates: ["cover"] }
      });
      expect(text).toContain("Page templates: 3 changes, + 1 new template.");
      expect(text).toContain("=== page{template=cover}");
    });

    it("rolls up applied token edits", () => {
      const text = formatInitRoundup(baseResult, {
        tokens: { outcome: "applied", editCount: 4 }
      });
      expect(text).toContain("Design tokens: 4 changes.");
    });

    it("notes a recorded commit", () => {
      const text = formatInitRoundup(baseResult, { commit: "made" });
      expect(text).toContain("Commit: initial commit recorded.");
    });

    it("returns '' on the refused-conflict path", () => {
      const text = formatInitRoundup({
        ...baseResult,
        files: [],
        conflicts: ["styles.css"]
      });
      expect(text).toBe("");
    });

    it("returns a configure-only summary when scaffold was a no-op but the configurator ran", () => {
      const text = formatInitRoundup(
        { ...baseResult, files: [{ path: "project.yaml", action: "preserved" }] },
        { page: { outcome: "applied", editCount: 1, addedTemplates: [] } }
      );
      expect(text).toContain("Configuration applied:");
      expect(text).toContain("Page templates: 1 change.");
    });
  });

  describe("skill scaffolding", () => {
    it("installs the skill into .claude/skills/tender-author when opted in", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tender-init-skill-"));
      try {
        const result = await init(dir, { skill: true, git: false });
        expect(result.skill).toBe("installed");
        const skillMd = await readFile(
          join(dir, SKILL_PROJECT_PATH, "SKILL.md"), "utf8"
        );
        expect(skillMd).toContain("tender-author");
        // Maintainer-internal files must NOT ship into a user project.
        const status = await stat(join(dir, SKILL_PROJECT_PATH, "STATUS.md"))
          .then(() => true).catch(() => false);
        expect(status).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not install the skill by default (skill omitted)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tender-init-skill-"));
      try {
        const result = await init(dir, { git: false });
        expect(result.skill).toBe("skipped");
        const present = await stat(join(dir, ".claude"))
          .then(() => true).catch(() => false);
        expect(present).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("leaves an existing skill dir untouched unless forced", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tender-addskill-"));
      try {
        const first = await installSkill(dir, false);
        expect(first).toBe("installed");
        // Tamper, then a non-forced re-install must not clobber it.
        const md = join(dir, SKILL_PROJECT_PATH, "SKILL.md");
        await writeFile(md, "TAMPERED");
        const second = await installSkill(dir, false);
        expect(second).toBe("exists");
        expect(await readFile(md, "utf8")).toBe("TAMPERED");
        // Force refreshes from the bundled payload.
        const third = await installSkill(dir, true);
        expect(third).toBe("installed");
        expect(await readFile(md, "utf8")).toContain("tender-author");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("formatSkillInstall maps outcomes to message + exit code", () => {
      expect(formatSkillInstall("installed").exitCode).toBe(0);
      expect(formatSkillInstall("exists").exitCode).toBe(0);
      expect(formatSkillInstall("exists").message).toMatch(/--force/);
      expect(formatSkillInstall("missing-payload").exitCode).toBe(1);
    });
  });

  describe("git opt-out and out/ tracking", () => {
    it("skips git init when git:false", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tender-init-nogit-"));
      try {
        const result = await init(dir, { git: false });
        expect(result.git.action).toBe("skipped");
        const dotGit = await stat(join(dir, ".git"))
          .then(() => true).catch(() => false);
        expect(dotGit).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("ignores out/ in .gitignore by default", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tender-init-out-"));
      try {
        await init(dir, { git: false });
        const gi = await readFile(join(dir, ".gitignore"), "utf8");
        expect(gi).toMatch(/^out\/$/m);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("keeps out/ tracked when trackOut:true", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tender-init-out-"));
      try {
        const result = await init(dir, { git: false, trackOut: true });
        expect(result.trackOut).toBe(true);
        const gi = await readFile(join(dir, ".gitignore"), "utf8");
        expect(gi).not.toMatch(/^out\/$/m);
        // node_modules/ is still ignored — only the out/ block is dropped.
        expect(gi).toContain("node_modules/");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
