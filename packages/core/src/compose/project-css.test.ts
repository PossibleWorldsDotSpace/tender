import { describe, it, expect } from "vitest";
import { generateProjectCss } from "./project-css.js";

describe("generateProjectCss", () => {
  it("emits @page default with size and margin", () => {
    const css = generateProjectCss({
      "page-templates": {
        default: {
          size: "A5",
          margin: { top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm" }
        }
      }
    });
    expect(css).toContain("@page default");
    expect(css).toContain("size: A5");
    // margin is top right(=outer) bottom left(=inner)
    expect(css).toMatch(/margin:\s*18mm\s+14mm\s+20mm\s+18mm/);
    expect(css).toContain(".page { page: default; }");
  });

  it("emits @top-left and @bottom-center margin boxes from header/footer config", () => {
    const css = generateProjectCss({
      "page-templates": {
        default: {
          size: "A5",
          margin: { top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm" },
          headers: { left: "{chapter}", right: "{page}" },
          footers: { center: "{page}" }
        }
      }
    });
    expect(css).toContain("@top-left");
    expect(css).toContain("string(chapter)");
    expect(css).toContain("@top-right");
    expect(css).toContain("counter(page)");
    expect(css).toContain("@bottom-center");
    expect(css).toContain("string-set: chapter");
    expect(css).toContain("string-set: section");
  });

  it("emits :left and :right variants for verso/recto headers", () => {
    const css = generateProjectCss({
      "page-templates": {
        default: {
          size: "A5", margin: 0,
          headers: {
            "left-page": { left: "{page}", right: "{chapter}" },
            "right-page": { left: "{title}", right: "{page}" }
          }
        }
      }
    });
    expect(css).toContain("@page default:left");
    expect(css).toContain("@page default:right");
  });

  it("emits :first variant when headers is 'none' and headers-rest provides boxes", () => {
    const css = generateProjectCss({
      "page-templates": {
        default: { size: "A5", margin: 0 },
        "chapter-opener": {
          size: "A5", margin: 0,
          headers: "none",
          "headers-rest": { left: "{chapter}" }
        }
      }
    });
    expect(css).toContain("@page chapter-opener:first");
    expect(css).toContain("@page chapter-opener {");
    expect(css).toMatch(/@page chapter-opener \{[^}]*@top-left[^}]*\}/s);
  });

  it("emits hyphenation rules from typography config", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A5", margin: 0 } },
      typography: {
        lang: "en-GB",
        hyphenation: {
          enabled: true,
          "min-word-length": 6,
          "min-chars-before": 3,
          "min-chars-after": 3,
          "max-consecutive-hyphens": 2
        },
        orphans: 2,
        widows: 2
      }
    });
    expect(css).toContain("hyphens: auto");
    expect(css).toContain("hyphenate-limit-chars: 6 3 3");
    expect(css).toContain("hyphenate-limit-lines: 2");
    expect(css).toContain("orphans: 2");
    expect(css).toContain("widows: 2");
  });

  it("does not emit hyphens: auto when hyphenation.enabled is false", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A5", margin: 0 } },
      typography: { hyphenation: { enabled: false } }
    });
    expect(css).not.toContain("hyphens: auto");
  });

  it("works without typography config", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A5", margin: 0 } }
    });
    expect(css).toContain("@page default");
    expect(css).not.toContain("hyphenate-limit-chars");
  });

  it("emits @font-face rules from fonts config", () => {
    const css = generateProjectCss({
      "page-templates": { default: { size: "A5", margin: 0 } },
      fonts: [
        { family: "Display", file: "MackinacPro-Book.woff2", weight: 400, style: "normal" },
        { family: "Display", file: "MackinacPro-BookItalic.woff2", weight: 400, style: "italic" }
      ]
    });
    expect(css).toContain("@font-face");
    expect(css).toContain("font-family: 'Display'");
    expect(css).toContain("MackinacPro-Book.woff2");
    expect(css).toContain("MackinacPro-BookItalic.woff2");
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("font-style: italic");
    expect(css).toContain("format('woff2')");
  });

  it("emits string-set on body for the document title", () => {
    const css = generateProjectCss(
      {
        "page-templates": { default: { size: "A5", margin: 0 } }
      },
      { docTitle: "My Book" }
    );
    expect(css).toContain('string-set: title "My Book"');
  });
});
