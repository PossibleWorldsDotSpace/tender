import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./markdown.js";

describe("parseMarkdown", () => {
  it("renders a heading and a paragraph", async () => {
    const html = await parseMarkdown("# Hello\n\nA paragraph.\n");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>A paragraph.</p>");
  });
});
