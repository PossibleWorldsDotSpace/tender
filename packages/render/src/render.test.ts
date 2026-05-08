import { describe, it, expect } from "vitest";
import { renderHtml, renderPdf, createRenderSession } from "./render.js";

const FIXTURE = {
  html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>T</title>
<link rel="stylesheet" href="_project.css">
<link rel="stylesheet" href="styles.css">
</head><body><div class="page"><h1>Hello</h1><p>A paragraph.</p></div></body></html>`,
  projectCss: `@page default { size: A5; margin: 18mm 14mm 20mm 18mm; }
.page { page: default; }`,
  stylesCss: `body { font-family: serif; }`,
  projectDir: "/tmp" // unused by these tests
};

describe("renderHtml", () => {
  it("returns a self-contained HTML string with paginated content", async () => {
    const html = await renderHtml(FIXTURE);
    // Paged.js adds data-ref attributes to elements, so don't match the exact tag.
    expect(html).toMatch(/<h1[^>]*>Hello<\/h1>/);
    // Paged.js wraps content in pagedjs page elements after rendering
    expect(html).toMatch(/pagedjs/);
  }, 120_000);
});

describe("renderPdf", () => {
  it("returns a non-empty PDF buffer", async () => {
    const buf = await renderPdf(FIXTURE);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  }, 120_000);
});

describe("createRenderSession", () => {
  it("can render multiple documents on a single session", async () => {
    const session = await createRenderSession();
    try {
      const a = await session.renderHtml(FIXTURE);
      const b = await session.renderHtml(FIXTURE);
      expect(a).toMatch(/<h1[^>]*>Hello<\/h1>/);
      expect(b).toMatch(/<h1[^>]*>Hello<\/h1>/);
    } finally {
      await session.close();
    }
  }, 180_000);

  it("rejects renders after close()", async () => {
    const session = await createRenderSession();
    await session.close();
    await expect(session.renderHtml(FIXTURE)).rejects.toThrow(/closed/);
  }, 60_000);
});
