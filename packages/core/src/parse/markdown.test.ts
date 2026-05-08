import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./markdown.js";

describe("parseMarkdown", () => {
  it("renders a heading and a paragraph", async () => {
    const html = await parseMarkdown("# Hello\n\nA paragraph.\n");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>A paragraph.</p>");
  });

  it("preserves directive content as-is when allowDirectives is true", async () => {
    const html = await parseMarkdown(":::callout\nHello there\n:::\n", { allowDirectives: true });
    // Without component resolution, directives currently leave their content
    // and the directive name becomes part of the output (exact form depends on
    // remark-directive defaults — assert only on body content surviving).
    expect(html).toContain("Hello there");
  });
});
