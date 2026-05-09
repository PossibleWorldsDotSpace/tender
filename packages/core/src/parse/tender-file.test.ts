import { describe, it, expect } from "vitest";
import { parseTenderFile } from "./tender-file.js";

const opts = { name: "row", path: "/test/components/row.tender" };

describe("parseTenderFile", () => {
  it("parses frontmatter only", () => {
    const src = [
      "---",
      "params: [label, icon]",
      "---",
      ""
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.frontmatter.params).toEqual(["label", "icon"]);
    expect(f.template).toBe("");
    expect(f.style).toBeUndefined();
    expect(f.palette).toBeUndefined();
  });

  it("parses template only (no frontmatter)", () => {
    const src = [
      `<div class="x">{{{body}}}</div>`,
      ""
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.frontmatter).toEqual({});
    expect(f.template).toBe(`<div class="x">{{{body}}}</div>`);
    expect(f.offsets.frontmatter).toBeUndefined();
  });

  it("parses all four sections", () => {
    const src = [
      "---",
      "params: [label]",
      "---",
      "",
      `<div class="row">{{{body}}}</div>`,
      "",
      "<style>",
      ".row { display: grid; }",
      "</style>",
      "",
      "<palette>",
      `params: { label: "45 min" }`,
      `body: "Hello"`,
      "</palette>",
      ""
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.frontmatter.params).toEqual(["label"]);
    expect(f.template).toBe(`<div class="row">{{{body}}}</div>`);
    expect(f.style).toBe(".row { display: grid; }");
    expect(f.palette?.params).toEqual({ label: "45 min" });
    expect(f.palette?.body).toBe("Hello");
  });

  it("records 1-indexed line offsets for each section", () => {
    // Lines:
    // 1: ---
    // 2: params: [label]
    // 3: ---
    // 4: (blank)
    // 5: <div>{{{body}}}</div>
    // 6: (blank)
    // 7: <style>
    // 8: .row { display: grid; }
    // 9: </style>
    const src = [
      "---",
      "params: [label]",
      "---",
      "",
      "<div>{{{body}}}</div>",
      "",
      "<style>",
      ".row { display: grid; }",
      "</style>"
    ].join("\n");
    const f = parseTenderFile(src, opts);
    // Frontmatter content is just line 2 ("params: [label]"); start and end
    // both point at line 2 (last content line is inclusive).
    expect(f.offsets.frontmatter).toEqual({ start: 2, end: 2 });
    // Template range covers lines 4..6 (the lines after the closing --- and
    // before the <style> opener), even though leading/trailing blanks are
    // trimmed from the captured template content.
    expect(f.offsets.template.start).toBe(4);
    expect(f.offsets.template.end).toBe(6);
    // <style> opener is at line 7; inner content starts at line 8 and ends
    // at line 8 (the closer is at line 9).
    expect(f.offsets.style).toEqual({ start: 8, end: 8 });
  });

  it("preserves Handlebars syntax in template", () => {
    const src = [
      "---",
      "params: [label]",
      "---",
      "",
      `<div>{{#if label}}<span>{{label}}</span>{{/if}}{{{body}}}</div>`
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.template).toContain("{{#if label}}");
    expect(f.template).toContain("{{label}}");
    expect(f.template).toContain("{{{body}}}");
  });

  it("does not split on `</style>` strings appearing inside CSS values", () => {
    // The CSS value contains the literal text `</style>` inside a content
    // string. Because the parser anchors at column 0, this should NOT close
    // the style block early.
    const src = [
      "<div></div>",
      "",
      "<style>",
      `.x::before { content: "</style>"; }`,
      ".y { color: red; }",
      "</style>"
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.style).toContain(`content: "</style>";`);
    expect(f.style).toContain(".y { color: red; }");
  });

  it("does not split on indented `</style>` lines", () => {
    const src = [
      "<div></div>",
      "",
      "<style>",
      ".x { color: red; }",
      "  </style>",   // indented; not a real closer
      ".y { color: blue; }",
      "</style>"
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.style).toContain(".y { color: blue; }");
  });

  it("errors on unclosed frontmatter", () => {
    const src = [
      "---",
      "params: [label]",
      "(no closing dashes)",
      ""
    ].join("\n");
    expect(() => parseTenderFile(src, opts)).toThrow(/frontmatter.*never closed/);
  });

  it("errors on unclosed <style> block", () => {
    const src = [
      "<div></div>",
      "",
      "<style>",
      ".x { color: red; }"
      // no </style>
    ].join("\n");
    expect(() => parseTenderFile(src, opts)).toThrow(/no matching column-0 <\/style>/);
  });

  it("errors on duplicate <style> blocks", () => {
    const src = [
      "<div></div>",
      "",
      "<style>",
      ".x { color: red; }",
      "</style>",
      "",
      "<style>",
      ".y { color: blue; }",
      "</style>"
    ].join("\n");
    expect(() => parseTenderFile(src, opts)).toThrow(/duplicate <style>/);
  });

  it("errors on invalid frontmatter YAML", () => {
    const src = [
      "---",
      "params: [unclosed",
      "---"
    ].join("\n");
    expect(() => parseTenderFile(src, opts)).toThrow(/invalid frontmatter YAML/);
  });

  it("errors on frontmatter that is not a mapping", () => {
    const src = [
      "---",
      `"just a string"`,
      "---"
    ].join("\n");
    expect(() => parseTenderFile(src, opts)).toThrow(/frontmatter must be a YAML mapping/);
  });

  it("errors on invalid palette YAML", () => {
    const src = [
      "<div></div>",
      "",
      "<palette>",
      "params: [unclosed",
      "</palette>"
    ].join("\n");
    expect(() => parseTenderFile(src, opts)).toThrow(/invalid palette YAML/);
  });

  it("errors on palette failing schema validation", () => {
    const src = [
      "<div></div>",
      "",
      "<palette>",
      "params: 'not an object'",  // schema requires record<string,string>
      "</palette>"
    ].join("\n");
    expect(() => parseTenderFile(src, opts)).toThrow(/palette failed schema validation/);
  });

  it("accepts empty frontmatter", () => {
    const src = [
      "---",
      "---",
      "",
      "<div></div>"
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.frontmatter).toEqual({});
    expect(f.template).toBe("<div></div>");
  });

  it("accepts <style> and <palette> in either order", () => {
    const src1 = [
      "<div></div>",
      "",
      "<style>",
      ".x {}",
      "</style>",
      "",
      "<palette>",
      `body: "Hello"`,
      "</palette>"
    ].join("\n");
    const src2 = [
      "<div></div>",
      "",
      "<palette>",
      `body: "Hello"`,
      "</palette>",
      "",
      "<style>",
      ".x {}",
      "</style>"
    ].join("\n");
    const f1 = parseTenderFile(src1, opts);
    const f2 = parseTenderFile(src2, opts);
    expect(f1.style).toBe(".x {}");
    expect(f1.palette?.body).toBe("Hello");
    expect(f2.style).toBe(".x {}");
    expect(f2.palette?.body).toBe("Hello");
  });

  it("supports inline-component shorthand frontmatter", () => {
    // A simple inline component declares only frontmatter — no template body.
    // The loader (a later step) will synthesize the wrapper template.
    const src = [
      "---",
      "inline: true",
      "tag: span",
      "class: stage-direction",
      "---",
      ""
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.frontmatter.inline).toBe(true);
    expect(f.frontmatter.tag).toBe("span");
    expect(f.frontmatter.class).toBe("stage-direction");
    expect(f.template).toBe("");
  });

  it("preserves blank lines inside the template body", () => {
    // Trimming should only happen at the edges of the template region — a
    // template that intentionally puts blank lines between tags should keep
    // them.
    const src = [
      "---",
      "params: []",
      "---",
      "",
      "<div>",
      "",
      "  <p>Hi</p>",
      "",
      "</div>",
      ""
    ].join("\n");
    const f = parseTenderFile(src, opts);
    expect(f.template).toBe("<div>\n\n  <p>Hi</p>\n\n</div>");
  });

  it("includes the file path in error messages", () => {
    const src = "---\nfoo: [\n---";
    expect(() => parseTenderFile(src, opts)).toThrow(/\/test\/components\/row\.tender/);
  });
});
