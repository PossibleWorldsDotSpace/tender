import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLint } from "./index.js";

async function projectFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-lint-multidoc-"));
  await writeFile(
    join(dir, "project.yaml"),
    "page-templates:\n  default:\n    size: A4\n    margin: 0\n"
  );
  await writeFile(join(dir, "styles.css"), "");
  await mkdir(join(dir, "components"), { recursive: true });
  await writeFile(join(dir, "content.md"), "<unknown-a>x</unknown-a>");
  await writeFile(join(dir, "resume.md"), "<unknown-b>y</unknown-b>");
  return dir;
}

async function baseProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-lint-multidoc-"));
  await writeFile(
    join(dir, "project.yaml"),
    "page-templates:\n  default:\n    size: A4\n    margin: 0\n"
  );
  await writeFile(join(dir, "styles.css"), "");
  await mkdir(join(dir, "components"), { recursive: true });
  return dir;
}

describe("lint across multiple documents", () => {
  it("reports unknown-component findings for every doc with the correct path", async () => {
    const dir = await projectFixture();
    const report = await runLint(dir);
    const paths = new Set(report.findings.map(f => f.path));
    expect(paths.has(join(dir, "content.md"))).toBe(true);
    expect(paths.has(join(dir, "resume.md"))).toBe(true);
  });

  it("does not flag a component as unused when only a non-content doc references it", async () => {
    // Cross-doc reachability: component referenced from resume.md only.
    const dir = await baseProject();
    await writeFile(
      join(dir, "components", "side-note.tender"),
      "<aside class=\"side-note\">{{{children}}}</aside>\n"
    );
    await writeFile(join(dir, "content.md"), "Hello.");
    await writeFile(join(dir, "resume.md"), "<side-note>hi</side-note>");
    const report = await runLint(dir);
    const unused = report.findings.filter(f => f.code === "tender/unused-component");
    expect(unused.find(f => /side-note/.test(f.message))).toBeUndefined();
  });

  it("attaches the non-content doc's path to a missing-asset finding from that doc", async () => {
    const dir = await baseProject();
    await writeFile(join(dir, "content.md"), "Hello.");
    await writeFile(
      join(dir, "resume.md"),
      "![avatar](./missing-from-resume.png)\n"
    );
    const report = await runLint(dir);
    const missing = report.findings.filter(
      f => f.code === "tender/missing-asset" && /missing-from-resume\.png/.test(f.message)
    );
    expect(missing.length).toBe(1);
    expect(missing[0]?.path).toBe(join(dir, "resume.md"));
  });

  it("reports a component-template missing-asset finding exactly once across multiple docs", async () => {
    // Regression: previously the component-template scan ran once per doc,
    // producing N duplicate findings.
    const dir = await baseProject();
    await writeFile(
      join(dir, "components", "logo.tender"),
      "<img src=\"./missing-logo.png\" alt=\"logo\" />\n"
    );
    await writeFile(join(dir, "content.md"), "<logo />");
    await writeFile(join(dir, "resume.md"), "<logo />");
    await writeFile(join(dir, "cover.md"), "<logo />");
    const report = await runLint(dir);
    const missing = report.findings.filter(
      f => f.code === "tender/missing-asset" && /missing-logo\.png/.test(f.message)
    );
    expect(missing.length).toBe(1);
    expect(missing[0]?.path).toMatch(/logo\.tender$/);
  });

  it("attaches the non-content doc's path to a deprecated :::name directive finding", async () => {
    const dir = await baseProject();
    await writeFile(join(dir, "content.md"), "Hello.");
    await writeFile(
      join(dir, "resume.md"),
      ":::row\nold-style\n:::\n"
    );
    const report = await runLint(dir);
    const dep = report.findings.filter(
      f => f.code === "tender/deprecated-syntax" && /:::row/.test(f.message)
    );
    expect(dep.length).toBeGreaterThanOrEqual(1);
    expect(dep[0]?.path).toBe(join(dir, "resume.md"));
  });
});
