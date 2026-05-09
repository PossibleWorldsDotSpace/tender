import { describe, it, expect } from "vitest";
import { parseProject } from "./project-parser.js";
import type { ProjectConfig } from "../config/schema.js";

const wrapperConfig = {
  "page-templates": { default: { size: "A5", margin: 0 as const } },
  components: {
    callout: { tag: "aside", class: "callout", params: ["variant"] },
    "stage-direction": { tag: "span", class: "stage-direction", inline: true }
  }
} as unknown as ProjectConfig;

describe("wrapper components", () => {
  it("rewrites a known block component", async () => {
    const { html } = await parseProject(":::callout{variant=warning}\nWatch out.\n:::\n", wrapperConfig);
    expect(html).toContain('<aside class="callout" data-variant="warning">');
    expect(html).toContain("Watch out.");
  });

  it("rewrites an inline component", async () => {
    const { html } = await parseProject("Note :stage-direction[whispers] here.", wrapperConfig);
    expect(html).toContain('<span class="stage-direction">whispers</span>');
  });

  it("errors on unknown component name", async () => {
    await expect(parseProject(":::unknown\nhi\n:::\n", wrapperConfig)).rejects.toThrow(/unknown component/i);
  });

  it("errors when an inline-only component is used as a block", async () => {
    await expect(
      parseProject(":::stage-direction\nblocky\n:::\n", wrapperConfig)
    ).rejects.toThrow(/inline-only/);
  });
});

describe("block-template components (single-slot)", () => {
  const config = {
    "page-templates": { default: { size: "A5", margin: 0 as const } },
    components: {
      row: {
        params: ["label", "icon"],
        template: `<div class="row">
  <div class="col-l">
    {{#if label}}<span class="margin-label">{{label}}</span>{{/if}}
  </div>
  <div class="col-r">{{{body}}}</div>
</div>`
      }
    }
  } as unknown as ProjectConfig;

  it("expands a template with a parameter and a body", async () => {
    const { html } = await parseProject(
      `:::row{label="45 min"}\n#### Stage 1\n\nThe welcome.\n:::\n`,
      config
    );
    expect(html).toContain('class="row"');
    expect(html).toContain('class="margin-label">45 min<');
    expect(html).toContain("Stage 1");
    expect(html).toContain("The welcome");
  });

  it("expands a template without parameters", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        callout: {
          template: `<aside class="callout">{{{body}}}</aside>`
        }
      }
    } as unknown as ProjectConfig;
    const { html } = await parseProject(":::callout\nWatch out.\n:::\n", cfg);
    expect(html).toContain('<aside class="callout">');
    expect(html).toContain("Watch out");
  });
});

describe("block-template components (multi-slot)", () => {
  it("expands a multi-slot template", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        "ad-lib": {
          slots: ["suggested"],
          template: `<div class="ad-lib"><div class="s">{{{suggested}}}</div><div class="b">your version</div></div>`
        }
      }
    } as unknown as ProjectConfig;
    const src = `:::ad-lib
--- suggested ---
"Hello world."
:::
`;
    const { html } = await parseProject(src, cfg);
    expect(html).toContain('class="ad-lib"');
    expect(html).toContain('"Hello world."');
  });

  it("recognizes @@ slotname as the new slot sentinel", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        "ad-lib": {
          slots: ["suggested"],
          template: `<div class="ad-lib"><div class="s">{{{suggested}}}</div></div>`
        }
      }
    } as unknown as ProjectConfig;
    const src = `<ad-lib>\n@@ suggested\n\n"Hi."\n</ad-lib>\n`;
    const { html } = await parseProject(src, cfg);
    expect(html).toContain('class="ad-lib"');
    expect(html).toContain('"Hi."');
  });

  it("@@ form produces byte-identical output to legacy --- form", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        "ad-lib": {
          slots: ["suggested"],
          template: `<div class="ad-lib"><div class="s">{{{suggested}}}</div></div>`
        }
      }
    } as unknown as ProjectConfig;
    const a = await parseProject(
      `<ad-lib>\n@@ suggested\n\n"Hello world."\n</ad-lib>\n`,
      cfg
    );
    const b = await parseProject(
      `<ad-lib>\n--- suggested ---\n\n"Hello world."\n</ad-lib>\n`,
      cfg
    );
    expect(a.html).toBe(b.html);
  });

  it("errors when a multi-slot template's required slot is missing", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: { "ad-lib": { slots: ["suggested"], template: "<div></div>" } }
    } as unknown as ProjectConfig;
    await expect(parseProject(`:::ad-lib\nno sentinels\n:::\n`, cfg)).rejects.toThrow(/missing slot/i);
  });
});

describe("built-in page component", () => {
  it("supports the built-in page component without explicit declaration", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } }
    } as unknown as ProjectConfig;
    const { html } = await parseProject(`:::page\n# Hello\n:::\n`, cfg);
    expect(html).toContain('class="page"');
    expect(html).toContain("Hello");
  });

  it("page applies a named page-template via template= attr", async () => {
    const cfg = {
      "page-templates": {
        default: { size: "A5", margin: 0 as const },
        "chapter-opener": { size: "A5", margin: 0 as const }
      }
    } as unknown as ProjectConfig;
    const { html } = await parseProject(`:::page{template="chapter-opener"}\n## Stage 1\n:::\n`, cfg);
    expect(html).toContain('data-page-template="chapter-opener"');
  });

  it("reports startsWithPage=true when source opens with :::page", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } }
    } as unknown as ProjectConfig;
    const result = await parseProject(`:::page\n# Hello\n:::\n`, cfg);
    expect(result.startsWithPage).toBe(true);
  });

  it("reports startsWithPage=true when prose source is auto-wrapped by the page preprocessor", async () => {
    // With item 4's preprocessPageBoundaries, prose-opening content gets an
    // implicit <page> wrap, so the AST always starts with a page directive
    // under the default tag-syntax pipeline.
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } }
    } as unknown as ProjectConfig;
    const result = await parseProject(`# A heading\n\nA paragraph.\n`, cfg);
    expect(result.startsWithPage).toBe(true);
  });

  it("reports startsWithPage=false when source opens with prose under TENDER_TAG_SYNTAX=0", async () => {
    // The escape-hatch path skips preprocessPageBoundaries entirely; under
    // it, startsWithPage retains its original meaning.
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } }
    } as unknown as ProjectConfig;
    process.env.TENDER_TAG_SYNTAX = "0";
    try {
      const result = await parseProject(`# A heading\n\nA paragraph.\n`, cfg);
      expect(result.startsWithPage).toBe(false);
    } finally {
      delete process.env.TENDER_TAG_SYNTAX;
    }
  });

  it("reports startsWithPage=false when first directive is not page under TENDER_TAG_SYNTAX=0", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        callout: { template: `<aside>{{{body}}}</aside>` }
      }
    } as unknown as ProjectConfig;
    process.env.TENDER_TAG_SYNTAX = "0";
    try {
      const result = await parseProject(`:::callout\nHi\n:::\n`, cfg);
      expect(result.startsWithPage).toBe(false);
    } finally {
      delete process.env.TENDER_TAG_SYNTAX;
    }
  });
});
