import { describe, it, expect } from "vitest";
import { preprocessTags } from "./preprocess-tags.js";

const blockOnly = {
  registry: new Set(["row", "callout", "page", "cover-spiral"]),
  inlineNames: new Set<string>()
};

const withInline = {
  registry: new Set(["row", "callout", "stage-direction", "sc"]),
  inlineNames: new Set(["stage-direction", "sc"])
};

describe("preprocessTags — block tags", () => {
  it("rewrites <row>body</row> as :::row", () => {
    const { source } = preprocessTags("<row>body</row>", blockOnly);
    expect(source).toContain(":::row");
    expect(source).toContain("body");
    expect(source).toContain(":::");
  });

  it("forwards attributes to the directive", () => {
    const { source } = preprocessTags(`<row label="x" icon=clock>body</row>`, blockOnly);
    expect(source).toContain(`:::row{label="x" icon="clock"}`);
  });

  it("emits boolean attributes as name=\"true\"", () => {
    const { source } = preprocessTags(`<row no-break>body</row>`, blockOnly);
    expect(source).toContain(`no-break="true"`);
  });

  it("escapes embedded double quotes in attribute values", () => {
    // Build via single-quoted source so we can include literal " in the value.
    const { source } = preprocessTags(`<row label='he said "hi"'>body</row>`, blockOnly);
    expect(source).toContain(`label="he said &quot;hi&quot;"`);
  });

  it("inserts blank lines around the directive so remark sees it as a block", () => {
    const { source } = preprocessTags(`Before.\n<row>x</row>\nAfter.`, blockOnly);
    // `\n\n:::row\n\n…\n\n:::\n\n` shape.
    expect(source).toMatch(/Before\.\s*\n\n:::row\n\n/);
    expect(source).toMatch(/\n\n:::\s*\n\nAfter\./);
  });

  it("self-closes <name /> as a no-body directive", () => {
    const { source } = preprocessTags(`<cover-spiral />`, blockOnly);
    expect(source).toContain(`:::cover-spiral`);
    // Empty body sandwiched between opener and closer.
    expect(source).toMatch(/:::cover-spiral\n\n:::/);
  });

  it("self-closes <name/> identically to <name />", () => {
    const a = preprocessTags(`<cover-spiral/>`, blockOnly).source;
    const b = preprocessTags(`<cover-spiral />`, blockOnly).source;
    expect(a).toBe(b);
  });

  it("handles <name></name> as an empty-body directive equivalent to self-close", () => {
    const a = preprocessTags(`<cover-spiral></cover-spiral>`, blockOnly).source;
    expect(a).toContain(`:::cover-spiral`);
  });
});

describe("preprocessTags — inline tags", () => {
  it("rewrites an inline tag mid-paragraph as :name[body]", () => {
    const { source } = preprocessTags(
      `Welcome. <stage-direction>he pauses</stage-direction> Today.`,
      withInline
    );
    expect(source).toContain(`Welcome. :stage-direction[he pauses] Today.`);
  });

  it("preserves attributes on inline tags", () => {
    const { source } = preprocessTags(
      `Note <sc class="lead">caps</sc>.`,
      withInline
    );
    expect(source).toContain(`:sc[caps]{class="lead"}`);
  });

  it("does not insert blank lines around an inline tag", () => {
    const { source } = preprocessTags(
      `A <stage-direction>x</stage-direction> B`,
      withInline
    );
    expect(source).toMatch(/^A :stage-direction\[x\] B$/);
  });
});

describe("preprocessTags — nesting", () => {
  it("rewrites <row><callout>x</callout></row> recursively", () => {
    const { source } = preprocessTags(`<row><callout>x</callout></row>`, blockOnly);
    expect(source).toContain(`:::row`);
    expect(source).toContain(`:::callout`);
    // The inner directive sits between the outer's body delimiters.
    const rowIdx = source.indexOf(":::row");
    const calloutIdx = source.indexOf(":::callout");
    const lastTripleColon = source.lastIndexOf(":::");
    expect(calloutIdx).toBeGreaterThan(rowIdx);
    expect(lastTripleColon).toBeGreaterThan(calloutIdx);
  });

  it("rewrites <row>**bold** and <stage-direction>x</stage-direction></row> preserving Markdown", () => {
    const { source } = preprocessTags(
      `<row>**bold** and <stage-direction>x</stage-direction></row>`,
      withInline
    );
    expect(source).toContain(":::row");
    expect(source).toContain("**bold**");
    expect(source).toContain(":stage-direction[x]");
  });
});

describe("preprocessTags — pass-through", () => {
  it("leaves an unregistered tag unchanged", () => {
    const { source } = preprocessTags(
      `<a href="https://example.com">link</a>`,
      blockOnly
    );
    expect(source).toBe(`<a href="https://example.com">link</a>`);
  });

  it("leaves <not-a-component>x</not-a-component> alone", () => {
    const { source } = preprocessTags(
      `<not-a-component>x</not-a-component>`,
      blockOnly
    );
    expect(source).toBe(`<not-a-component>x</not-a-component>`);
  });

  it("ignores tags inside fenced code blocks", () => {
    const src = "Hi.\n\n```html\n<row>x</row>\n```\n\nBye.";
    const { source } = preprocessTags(src, blockOnly);
    expect(source).toBe(src);
  });

  it("ignores tags inside ~~~ fenced code blocks", () => {
    const src = "~~~\n<row>x</row>\n~~~";
    const { source } = preprocessTags(src, blockOnly);
    expect(source).toBe(src);
  });

  it("ignores tags inside HTML comments", () => {
    const src = `<!-- <row>x</row> -->`;
    const { source } = preprocessTags(src, blockOnly);
    expect(source).toBe(src);
  });

  it("ignores tags inside an inline code span", () => {
    const src = "Use `<row>` to wrap.";
    const { source } = preprocessTags(src, blockOnly);
    expect(source).toBe(src);
  });
});

describe("preprocessTags — error cases", () => {
  it("errors on an unclosed registered opener", () => {
    expect(() => preprocessTags(`<row>body without closer`, blockOnly))
      .toThrow(/<row> is not closed/);
  });

  it("errors on a mismatched closer", () => {
    expect(() => preprocessTags(`<row>body</callout>`, blockOnly))
      .toThrow(/expected <\/row>/);
  });

  it("errors on a stray closing tag", () => {
    expect(() => preprocessTags(`</row>`, blockOnly))
      .toThrow(/no matching opener/);
  });

  it("includes the filename in error messages when supplied", () => {
    expect(() => preprocessTags(`</row>`, { ...blockOnly, filename: "content.md" }))
      .toThrow(/content\.md:/);
  });
});

describe("preprocessTags — source map", () => {
  it("maps a literal-only span 1-1", () => {
    const src = "Hello world.";
    const { source, sourceMap } = preprocessTags(src, blockOnly);
    expect(source).toBe(src);
    expect(sourceMap).toEqual([
      { rewrittenStart: 0, originalStart: 0, length: src.length }
    ]);
  });

  it("maps the body of a rewritten block tag back to the original offsets", () => {
    const src = `Before <row>BODY</row> after`;
    const { source, sourceMap } = preprocessTags(src, blockOnly);
    // Find `BODY` in the rewritten output and verify its source-map entry
    // points at the original `BODY` offset (which is 12 in `src`).
    const bodyIdx = source.indexOf("BODY");
    expect(bodyIdx).toBeGreaterThan(0);
    const entry = sourceMap.find(
      e => e.rewrittenStart <= bodyIdx && bodyIdx < e.rewrittenStart + e.length
    );
    expect(entry).toBeDefined();
    const offsetWithinSegment = bodyIdx - entry!.rewrittenStart;
    const originalOffset = entry!.originalStart + offsetWithinSegment;
    expect(src.slice(originalOffset, originalOffset + 4)).toBe("BODY");
  });

  it("maps content inside a nested tag's body back to the outermost source", () => {
    const src = `<row>before <callout>INNER</callout> after</row>`;
    const { source, sourceMap } = preprocessTags(src, blockOnly);
    const innerIdx = source.indexOf("INNER");
    const entry = sourceMap.find(
      e => e.rewrittenStart <= innerIdx && innerIdx < e.rewrittenStart + e.length
    );
    expect(entry).toBeDefined();
    const offsetWithinSegment = innerIdx - entry!.rewrittenStart;
    const originalOffset = entry!.originalStart + offsetWithinSegment;
    expect(src.slice(originalOffset, originalOffset + 5)).toBe("INNER");
  });
});

describe("preprocessTags — parseProject integration", () => {
  it("rewrites tag syntax to directive form before remark sees it", async () => {
    const { parseProject } = await import("./project-parser.js");
    const config = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        callout: { tag: "aside", class: "callout", params: ["variant"] }
      }
    } as any;
    const { html } = await parseProject(
      `<callout variant="warning">Watch.</callout>\n`,
      config
    );
    expect(html).toContain(`<aside class="callout" data-variant="warning">`);
    expect(html).toContain("Watch.");
  });

  it("respects the inline flag for inline-only components", async () => {
    const { parseProject } = await import("./project-parser.js");
    const config = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        "stage-direction": { tag: "span", class: "stage-direction", inline: true }
      }
    } as any;
    const { html } = await parseProject(
      `Hello <stage-direction>he pauses</stage-direction> world.\n`,
      config
    );
    expect(html).toContain(`<span class="stage-direction">he pauses</span>`);
    // Should still be in a single paragraph (no block split).
    expect(html).toMatch(/<p>[^<]*Hello.*world\.[^<]*<\/p>/s);
  });

  it("can be disabled with TENDER_TAG_SYNTAX=0 — escape hatch", async () => {
    process.env.TENDER_TAG_SYNTAX = "0";
    try {
      const { parseProject } = await import("./project-parser.js");
      const config = {
        "page-templates": { default: { size: "A5", margin: 0 as const } },
        components: {
          callout: { tag: "aside", class: "callout", params: ["variant"] }
        }
      } as any;
      // With the preprocessor disabled, <callout> is just raw HTML; remark
      // forwards it as-is and the component resolver doesn't see a directive
      // for "callout" — so the output contains the literal tag, not the
      // resolved <aside>.
      const { html } = await parseProject(
        `<callout variant="warning">Watch.</callout>\n`,
        config
      );
      expect(html).toContain(`<callout variant="warning">`);
      expect(html).not.toContain(`<aside`);
    } finally {
      delete process.env.TENDER_TAG_SYNTAX;
    }
  });
});
