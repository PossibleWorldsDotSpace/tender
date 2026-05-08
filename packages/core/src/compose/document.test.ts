import { describe, it, expect } from "vitest";
import { composeDocument } from "./document.js";

describe("composeDocument", () => {
  it("wraps body HTML in an HTML5 document with both stylesheet links", () => {
    const html = composeDocument({
      bodyHtml: "<h1>Hi</h1>",
      lang: "en-GB",
      title: "Test"
    });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('href="_project.css"');
    expect(html).toContain('href="styles.css"');
    expect(html).toContain("<h1>Hi</h1>");
  });
});
