import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clean, formatChangeSummary } from "./clean.js";

// NBSP escape so test fixtures can include them unambiguously.
const NBSP = "\u00A0";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "tender-clean-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("clean command", () => {
  it("writes a cleaned file when --yes is set", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, `hello${NBSP}world\n`);
    const r = await clean(path, { yes: true });
    expect(r.action).toBe("wrote");
    expect(r.exitCode).toBe(0);
    const after = await readFile(path, "utf8");
    expect(after).toBe("hello world\n");
  });

  it("--check exits 1 when changes are pending; doesn't write", async () => {
    const path = join(tmp, "content.md");
    const original = `hello${NBSP}world\n`;
    await writeFile(path, original);
    const r = await clean(path, { check: true });
    expect(r.exitCode).toBe(1);
    expect(r.action).toBe("check-dirty");
    const after = await readFile(path, "utf8");
    expect(after).toBe(original);
  });

  it("--check exits 0 on a clean file", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "clean prose\n");
    const r = await clean(path, { check: true });
    expect(r.exitCode).toBe(0);
    expect(r.action).toBe("no-changes");
  });

  it("default mode prompts; writes on 'y'", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, `hello${NBSP}world\n`);
    const r = await clean(path, { prompt: async () => "y\n" });
    expect(r.action).toBe("wrote");
    const after = await readFile(path, "utf8");
    expect(after).toBe("hello world\n");
  });

  it("default mode prompts; does not write on 'n'", async () => {
    const path = join(tmp, "content.md");
    const original = `hello${NBSP}world\n`;
    await writeFile(path, original);
    const r = await clean(path, { prompt: async () => "n\n" });
    expect(r.action).toBe("skipped");
    const after = await readFile(path, "utf8");
    expect(after).toBe(original);
  });

  it("reports 'no changes' on a clean file", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "clean prose\n");
    const r = await clean(path, { yes: true });
    expect(r.action).toBe("no-changes");
    expect(r.summary).toMatch(/no changes/);
  });

  it("--typography produces different output than no flag for content with `--`", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, "wait -- pause\n");
    const without = await clean(path, { yes: true });
    // Reset.
    await writeFile(path, "wait -- pause\n");
    const withFlag = await clean(path, { yes: true, typography: true });
    expect(withFlag.result.output).not.toBe(without.result.output);
    expect(withFlag.result.output).toContain("—"); // —
  });

  it("project.yaml clean.typography: smart is equivalent to --typography", async () => {
    await writeFile(
      join(tmp, "project.yaml"),
      "page-templates: { default: { size: A5, margin: 0 } }\nclean: { typography: smart }\n"
    );
    const path = join(tmp, "content.md");
    await writeFile(path, "wait -- pause\n");
    const r = await clean(path, { yes: true });
    expect(r.result.output).toContain("—");
  });

  it("running clean twice produces no changes the second time", async () => {
    const path = join(tmp, "content.md");
    await writeFile(path, `﻿hello world​\n`);
    const first = await clean(path, { yes: true });
    expect(first.action).toBe("wrote");
    const second = await clean(path, { yes: true });
    expect(second.action).toBe("no-changes");
  });

  it("formatChangeSummary lists each rule's description", () => {
    const text = formatChangeSummary("content.md", {
      output: "x",
      changes: [
        { code: "clean/bom", count: 1, description: "BOM removed" },
        { code: "clean/nbsp", count: 3, description: "3 NBSPs normalized to space" }
      ]
    }, false);
    expect(text).toContain("BOM removed");
    expect(text).toContain("3 NBSPs normalized");
  });
});
