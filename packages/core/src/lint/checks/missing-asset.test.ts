import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLint } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../../test/fixtures/lint");

describe("tender/missing-asset", () => {
  it("fires on a relative reference to a non-existent file", async () => {
    const r = await runLint(join(fixtures, "missing-asset-positive"));
    const missing = r.findings.filter(f => f.code === "tender/missing-asset");
    // The fixture has two missing references: one in component template
    // (spiral.png) and one in content.md markdown image
    // (missing-from-content.png).
    expect(missing.length).toBe(2);
    expect(missing.every(f => f.severity === "error")).toBe(true);
    expect(missing.some(f => /spiral\.png/.test(f.message))).toBe(true);
    expect(missing.some(f => /missing-from-content\.png/.test(f.message))).toBe(true);
  });

  it("does not fire when assets are present", async () => {
    const r = await runLint(join(fixtures, "missing-asset-negative"));
    expect(r.findings.filter(f => f.code === "tender/missing-asset"))
      .toEqual([]);
  });

  it("skips http(s) URIs", async () => {
    // The negative fixture has an https://example.com/x.png reference;
    // that should be skipped, not flagged as missing.
    const r = await runLint(join(fixtures, "missing-asset-negative"));
    expect(r.findings.filter(f => /example\.com/.test(f.message)))
      .toEqual([]);
  });
});
