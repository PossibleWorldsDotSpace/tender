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

describe("lint across multiple documents", () => {
  it("reports unknown-component findings for every doc with the correct path", async () => {
    const dir = await projectFixture();
    const report = await runLint(dir);
    const paths = new Set(report.findings.map(f => f.path));
    expect(paths.has(join(dir, "content.md"))).toBe(true);
    expect(paths.has(join(dir, "resume.md"))).toBe(true);
  });
});
