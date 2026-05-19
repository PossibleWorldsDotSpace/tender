import { describe, it, expect } from "vitest";
import { runPageSetup, runTokenPicker } from "./index.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Driver-level safety contract: both interactive drivers MUST refuse to run
 * without a TTY rather than block forever waiting on stdin. The full TUI
 * feel is verified manually (see #17); this guards the non-interactive
 * guardrail, which is the dangerous-to-regress part.
 */
const YAML = `page-templates:
  default:
    size: A5
    margin: 0
design-tokens:
  color:
    ink: '#111111'
`;

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-drivers-"));
  await writeFile(join(dir, "project.yaml"), YAML);
  return dir;
}

describe("config-edit drivers — non-TTY guard", () => {
  it("runPageSetup rejects when isTTY is false", async () => {
    const dir = await project();
    try {
      await expect(runPageSetup(dir, { isTTY: false })).rejects.toThrow(
        /interactive and needs a terminal/
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runTokenPicker rejects when isTTY is false", async () => {
    const dir = await project();
    try {
      await expect(runTokenPicker(dir, { isTTY: false })).rejects.toThrow(
        /interactive and needs a terminal/
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
