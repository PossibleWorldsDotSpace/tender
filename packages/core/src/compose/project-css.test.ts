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
