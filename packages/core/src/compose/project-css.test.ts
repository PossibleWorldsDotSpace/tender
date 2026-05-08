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
});
