import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProject } from "@tender/core";
import { renderPdf } from "../render.js";
import { extractPdfStructure } from "./extract-pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../core/test/fixtures");

/**
 * Verify that typography rules emitted to CSS actually take effect in the
 * rendered output. The "typography" fixture is deliberately authored with
 * very long words ("antidisestablishmentarianism") in a narrow A6 column;
 * this means line-break decisions are forced to interact with the hyphen-
 * ation rule, so the rendered text will contain hyphenated word fragments
 * if hyphens: auto is being honored end-to-end.
 *
 * We assert on extracted PDF text rather than the pre-pagination HTML
 * because Paged.js + Chromium do hyphenation as part of layout: the input
 * HTML contains plain words; the PDF text contains hyphen-broken fragments.
 */
describe("typography end-to-end", () => {
  it("hyphenates long words when hyphenation is enabled", async () => {
    const built = await buildProject(join(fixturesDir, "typography"));
    const pdf = await renderPdf(built);
    const structure = await extractPdfStructure(new Uint8Array(pdf));
    expect(structure.pageCount).toBeGreaterThan(0);

    // Concatenate all page text. Look for any of the long words appearing as
    // a hyphen-broken fragment: "antidis‐", "incomprehens‐", "transconti‐"
    // (Chromium emits U+2010 HYPHEN, not ASCII '-'). Any one is sufficient
    // evidence of hyphenation.
    const allText = structure.pages.map(p => p.text).join(" ");
    const hyphenBreakPattern = /\b[a-z]{4,}[‐\-]\s+[a-z]{2,}/i;
    expect(allText).toMatch(hyphenBreakPattern);
  }, 120_000);

  it("project.yaml hyphenation block is wired through to generated CSS", async () => {
    const built = await buildProject(join(fixturesDir, "typography"));
    // The project CSS should contain the hyphenation properties driven by
    // the project.yaml typography.hyphenation block. This guards against
    // regressions where the CSS stops being emitted altogether.
    expect(built.projectCss).toMatch(/hyphens\s*:\s*auto/);
    // hyphenate-limit-chars takes the configured min-word-length / before /
    // after values; just assert at least one of them is present.
    expect(built.projectCss).toMatch(/hyphenate-limit-chars/);
  });

  it("orphans and widows reach the generated CSS when configured", async () => {
    // The "typography-orphans" fixture sets orphans/widows in project.yaml;
    // the generated CSS should reflect both values.
    const built = await buildProject(join(fixturesDir, "typography-orphans"));
    expect(built.projectCss).toMatch(/orphans\s*:\s*3/);
    expect(built.projectCss).toMatch(/widows\s*:\s*3/);
  });
});
