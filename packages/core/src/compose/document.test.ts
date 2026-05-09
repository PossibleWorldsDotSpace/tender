import { describe, it, expect } from "vitest";
import { composeDocument } from "./document.js";

describe("composeDocument", () => {
  it("wraps body HTML in an HTML5 document with all three stylesheet links", () => {
    const html = composeDocument({
      bodyHtml: "<h1>Hi</h1>",
      lang: "en-GB",
      title: "Test"
    });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('href="_project.css"');
    expect(html).toContain('href="_components.css"');
    expect(html).toContain('href="styles.css"');
    expect(html).toContain("<h1>Hi</h1>");
  });

  it("orders stylesheets project → components → user", () => {
    const html = composeDocument({ bodyHtml: "", lang: "en", title: "T" });
    const projectIdx = html.indexOf('href="_project.css"');
    const componentsIdx = html.indexOf('href="_components.css"');
    const stylesIdx = html.indexOf('href="styles.css"');
    expect(projectIdx).toBeGreaterThan(0);
    expect(componentsIdx).toBeGreaterThan(projectIdx);
    expect(stylesIdx).toBeGreaterThan(componentsIdx);
  });
});
