import { describe, it, expect } from "vitest";
import { buildToc } from "./toc.ts";

describe("buildToc", () => {
  it("extracts h2 and h3 entries with slug ids", () => {
    const { html, toc } = buildToc("<h2>Mental model</h2><p>p</p><h3>Sub heading</h3>");
    expect(toc).toEqual([
      { level: 2, text: "Mental model", slug: "mental-model" },
      { level: 3, text: "Sub heading", slug: "sub-heading" }
    ]);
    expect(html).toContain('id="mental-model"');
    expect(html).toContain('id="sub-heading"');
  });

  it("handles duplicate slugs by appending counter", () => {
    const { toc } = buildToc("<h2>Foo</h2><h2>Foo</h2>");
    expect(toc.map(t => t.slug)).toEqual(["foo", "foo-2"]);
  });

  it("ignores h1, h4, etc.", () => {
    const { toc } = buildToc("<h1>Title</h1><h2>Section</h2><h4>Sub-sub</h4>");
    expect(toc.map(t => t.text)).toEqual(["Section"]);
  });
});
