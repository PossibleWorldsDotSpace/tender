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
});
