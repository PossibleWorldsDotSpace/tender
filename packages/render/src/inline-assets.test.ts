import { describe, it, expect } from "vitest";
import { inlineAssets } from "./inline-assets.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Walk up to repo root then into the core fixture
const fixtureDir = join(here, "../../core/test/fixtures/with-image");

describe("inlineAssets", () => {
  it("rewrites <img src='assets/...'> to data URI", async () => {
    const html = `<html><body><img src="assets/images/dot.png"></body></html>`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).not.toContain('src="assets/images/dot.png"');
    expect(inlined).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  });

  it("leaves http(s) and data URIs alone", async () => {
    const html = `<img src="https://example.com/x.png"><img src="data:image/png;base64,xxx">`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).toContain('src="https://example.com/x.png"');
    expect(inlined).toContain('src="data:image/png;base64,xxx"');
  });

  it("ignores missing files (warns rather than throws)", async () => {
    const html = `<img src="assets/images/missing.png">`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(typeof inlined).toBe("string");
  });

  it("does not inline files outside the project directory", async () => {
    const html = `<img src="../../../etc/hostname">`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).toContain('src="../../../etc/hostname"');
    expect(inlined).not.toContain("data:");
  });

  it("does not inline absolute paths to system files", async () => {
    const html = `<img src="/etc/hostname">`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).toContain('src="/etc/hostname"');
    expect(inlined).not.toContain("data:image");
  });

  it("does not inline a traversed path even when the extension is allowed", async () => {
    // Path resolves outside the project root by climbing up; even though it
    // points back into another sibling fixture, it must be rejected.
    const escape = "../components/some.png";
    const html = `<img src="${escape}">`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).toContain(`src="${escape}"`);
    expect(inlined).not.toContain("data:image");
  });
});
