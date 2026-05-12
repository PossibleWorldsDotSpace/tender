import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inlineAssets, inlineFonts } from "./inline-assets.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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

  it("inlines all occurrences of the same image", async () => {
    const html = `<img src="assets/images/dot.png"><img src="assets/images/dot.png">`;
    const inlined = await inlineAssets(html, fixtureDir);
    const matches = inlined.match(/data:image\/png;base64/g);
    expect(matches?.length).toBe(2);
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

  it("inlines an <img> tag whose attributes span multiple lines", async () => {
    const html = `<img\n  src="assets/images/dot.png"\n  alt=""\n>`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).toMatch(/src="data:image\/png;base64,/);
    // The non-src parts of the tag are preserved verbatim.
    expect(inlined).toContain("alt=\"\"");
  });

  it("inlines an <img> with single-quoted src", async () => {
    const html = `<img src='assets/images/dot.png'>`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).toMatch(/src='data:image\/png;base64,/);
  });

  it("does not inline <img> tag strings inside HTML comments", async () => {
    const html = `<!-- <img src="assets/images/dot.png"> --><p>Body</p>`;
    const inlined = await inlineAssets(html, fixtureDir);
    expect(inlined).toBe(html);
    expect(inlined).not.toContain("data:image");
  });

  it("preserves surrounding HTML byte-for-byte except in modified <img> tags", async () => {
    const html = `<!doctype html><html><body>\n` +
      `  <p class="x">Hello &amp; world</p>\n` +
      `  <img src="assets/images/dot.png" alt="d">\n` +
      `  <p>End</p>\n` +
      `</body></html>`;
    const inlined = await inlineAssets(html, fixtureDir);
    // Everything outside the <img> tag is unchanged.
    expect(inlined).toContain(`<p class="x">Hello &amp; world</p>`);
    expect(inlined).toContain(`<p>End</p>`);
    expect(inlined).toContain("alt=\"d\"");
    // The img got its src rewritten.
    expect(inlined).toMatch(/src="data:image\/png;base64,/);
  });
});

describe("inlineFonts", () => {
  let dir: string;
  const FONT_BYTES = "fake-woff2-bytes"; // inlineFonts never parses the file

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tender-fonts-"));
    await mkdir(join(dir, "assets", "fonts"), { recursive: true });
    await writeFile(join(dir, "assets", "fonts", "Inter.woff2"), FONT_BYTES);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const dataUri = `data:font/woff2;base64,${Buffer.from(FONT_BYTES).toString("base64")}`;

  it("rewrites a relative url('assets/fonts/...') to a data URI", async () => {
    const css = `@font-face { font-family: 'Inter'; src: url('assets/fonts/Inter.woff2') format('woff2'); }`;
    const out = await inlineFonts(css, dir);
    expect(out).not.toContain("assets/fonts/Inter.woff2");
    expect(out).toContain(`url('${dataUri}')`);
  });

  it("rewrites an absolute file:// url (as Paged.js' polisher emits it)", async () => {
    const css = `@font-face { src: url(file://${dir}/assets/fonts/Inter.woff2) format('woff2'); }`;
    const out = await inlineFonts(css, dir);
    expect(out).toContain(`url(${dataUri})`);
  });

  it("preserves the original quoting style", async () => {
    expect(await inlineFonts(`x { src: url("assets/fonts/Inter.woff2"); }`, dir)).toContain(`url("${dataUri}")`);
    expect(await inlineFonts(`x { src: url(assets/fonts/Inter.woff2); }`, dir)).toContain(`url(${dataUri})`);
  });

  it("leaves non-font url()s untouched", async () => {
    const css = `body { background: url('assets/images/dot.png'); }`;
    expect(await inlineFonts(css, dir)).toBe(css);
  });

  it("leaves remote and data url()s untouched", async () => {
    const css = `@font-face { src: url(https://fonts.example/Inter.woff2), url(data:font/woff2;base64,abc); }`;
    expect(await inlineFonts(css, dir)).toBe(css);
  });

  it("leaves a missing font file untouched", async () => {
    const css = `@font-face { src: url('assets/fonts/Nope.woff2'); }`;
    expect(await inlineFonts(css, dir)).toBe(css);
  });

  it("does not read a font outside the project directory (traversal guard)", async () => {
    const css = `@font-face { src: url('../../../etc/hostname.woff2'); }`;
    expect(await inlineFonts(css, dir)).toBe(css);
    const abs = `@font-face { src: url(file:///etc/hostname.woff2); }`;
    expect(await inlineFonts(abs, dir)).toBe(abs);
  });

  it("inlines every reference to the same font", async () => {
    const css = `a{src:url('assets/fonts/Inter.woff2')} b{src:url('assets/fonts/Inter.woff2')}`;
    const out = await inlineFonts(css, dir);
    expect((out.match(/data:font\/woff2;base64,/g) ?? []).length).toBe(2);
  });

  it("returns the input unchanged when there is nothing to inline", async () => {
    const css = `body { color: red; }`;
    expect(await inlineFonts(css, dir)).toBe(css);
  });
});
