import { describe, it, expect } from "vitest";
import { preprocessInlineShortcuts } from "./preprocess-inline-shortcuts.js";

const speakerOnly = { "@": "speaker-name" };
const speakerAndTag = { "@": "speaker-name", "%": "yellow-tag" };

describe("preprocessInlineShortcuts", () => {
  it("rewrites a same-line span", () => {
    const r = preprocessInlineShortcuts("Welcome @speaker@ everyone.", speakerOnly);
    expect(r.source).toBe("Welcome <speaker-name>speaker</speaker-name> everyone.");
  });

  it("supports multiple shortcut characters in one document", () => {
    const r = preprocessInlineShortcuts("@a@ said %warning%.", speakerAndTag);
    expect(r.source).toBe('<speaker-name>a</speaker-name> said <yellow-tag>warning</yellow-tag>.');
  });

  it("does not span across newlines", () => {
    const r = preprocessInlineShortcuts("@text\nmore@", speakerOnly);
    // No closer on the same line → both `@` are literal.
    expect(r.source).toBe("@text\nmore@");
  });

  it("treats backslash-escaped characters as literal", () => {
    const r = preprocessInlineShortcuts("Email me at \\@user\\@.", speakerOnly);
    expect(r.source).toBe("Email me at @user@.");
  });

  it("treats empty span (`@@`) as literal", () => {
    const r = preprocessInlineShortcuts("Foo @@ bar.", speakerOnly);
    expect(r.source).toBe("Foo @@ bar.");
  });

  it("ignores shortcut characters inside fenced code blocks", () => {
    const src = "Lead.\n\n```\n@x@\n```\n\nMore.";
    const r = preprocessInlineShortcuts(src, speakerOnly);
    expect(r.source).toContain("@x@");
    expect(r.source).not.toContain("<speaker-name>");
  });

  it("ignores shortcut characters inside inline code spans", () => {
    const r = preprocessInlineShortcuts("Use `@x@` literally.", speakerOnly);
    expect(r.source).toContain("`@x@`");
    expect(r.source).not.toContain("<speaker-name>");
  });

  it("ignores shortcut characters inside HTML comments", () => {
    const r = preprocessInlineShortcuts("<!-- @x@ -->", speakerOnly);
    expect(r.source).toBe("<!-- @x@ -->");
  });

  it("ignores shortcut characters inside tag attributes", () => {
    const r = preprocessInlineShortcuts(`<row label="@x@">body</row>`, speakerOnly);
    expect(r.source).toContain(`label="@x@"`);
    expect(r.source).not.toContain("<speaker-name>");
  });

  it("returns input unchanged when no shortcuts are registered", () => {
    const src = "Hello @world@.";
    const r = preprocessInlineShortcuts(src, {});
    expect(r.source).toBe(src);
  });

  it("emits a source map covering literal segments", () => {
    const src = "@a@ and @b@";
    const r = preprocessInlineShortcuts(src, speakerOnly);
    for (const e of r.sourceMap) {
      expect(src.slice(e.originalStart, e.originalStart + e.length))
        .toBe(r.source.slice(e.rewrittenStart, e.rewrittenStart + e.length));
    }
  });

  it("preserves the inner text of a shortcut span verbatim", () => {
    const r = preprocessInlineShortcuts("@multi word phrase@", speakerOnly);
    expect(r.source).toBe("<speaker-name>multi word phrase</speaker-name>");
  });

  it("handles the § non-ASCII shortcut character", () => {
    const r = preprocessInlineShortcuts("§section§", { "§": "section-mark" });
    expect(r.source).toBe("<section-mark>section</section-mark>");
  });

  it("handles | shortcut character", () => {
    const r = preprocessInlineShortcuts("|stage|", { "|": "stage-direction" });
    expect(r.source).toBe("<stage-direction>stage</stage-direction>");
  });

  it("does not expand inside an open <tag attr=...> until > is reached", () => {
    // Multi-attribute opener with a shortcut char outside any quoted value
    // — the scanner should still treat the entire opener as literal.
    const r = preprocessInlineShortcuts(
      `<row a="x" b="y">@speaker@</row>`,
      speakerOnly
    );
    expect(r.source).toContain(`<row a="x" b="y">`);
    expect(r.source).toContain("<speaker-name>speaker</speaker-name>");
  });

  it("treats orphan shortcut character at end of line as literal", () => {
    const r = preprocessInlineShortcuts("Lone @ here.", speakerOnly);
    expect(r.source).toBe("Lone @ here.");
  });
});
