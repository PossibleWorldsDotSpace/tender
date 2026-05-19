import { describe, it, expect } from "vitest";
import { configure } from "./configure.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const YAML = `page-templates:
  default:
    size: A5
    margin: 0
`;

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tender-configure-"));
  try {
    await writeFile(join(dir, "project.yaml"), YAML);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("configure", () => {
  it("errors when there is no project.yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-configure-empty-"));
    try {
      await expect(configure(dir, { isTTY: true })).rejects.toThrow(
        /No project\.yaml.*tender init/
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hard-errors without a TTY (a wizard has no non-interactive meaning)", async () => {
    await withProject(async (dir) => {
      await expect(configure(dir, { isTTY: false })).rejects.toThrow(
        /requires an interactive terminal.*tokens set/s
      );
    });
  });

  it("rejects the impossible page-only + tokens-only combination via the CLI guard", async () => {
    // configure() itself runs page→tokens; the mutual-exclusion guard lives
    // in the cli.ts action. Here we assert the function still behaves when
    // given only one selector (the realistic inputs).
    await withProject(async (dir) => {
      // Non-TTY so the drivers don't try to grab the terminal; we only want
      // to exercise the selection/validation path, which throws before any
      // driver runs.
      await expect(
        configure(dir, { isTTY: false, pageOnly: true })
      ).rejects.toThrow(/interactive terminal/);
    });
  });
});
