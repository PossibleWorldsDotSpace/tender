import { describe, it, expect } from "vitest";
import { parseProject } from "./project-parser.js";
import type { ProjectConfig } from "../config/schema.js";

const config = {
  "page-templates": { default: { size: "A5", margin: 0 as const } },
  templates: {
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

describe("template resolution (single-slot)", () => {
  it("expands a template with a parameter and a body", async () => {
    const html = await parseProject(
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
      templates: {
        callout: {
          template: `<aside class="callout">{{{body}}}</aside>`
        }
      }
    } as unknown as ProjectConfig;
    const html = await parseProject(":::callout\nWatch out.\n:::\n", cfg);
    expect(html).toContain('<aside class="callout">');
    expect(html).toContain("Watch out");
  });

  it("expands a multi-slot template", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      templates: {
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
    const html = await parseProject(src, cfg);
    expect(html).toContain('class="ad-lib"');
    expect(html).toContain('"Hello world."');
  });

  it("supports the built-in page template without explicit declaration", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } }
    } as unknown as ProjectConfig;
    const html = await parseProject(`:::page\n# Hello\n:::\n`, cfg);
    expect(html).toContain('class="page"');
    expect(html).toContain("Hello");
  });

  it("page template applies a named page template via template= attr", async () => {
    const cfg = {
      "page-templates": {
        default: { size: "A5", margin: 0 as const },
        "chapter-opener": { size: "A5", margin: 0 as const }
      }
    } as unknown as ProjectConfig;
    const html = await parseProject(`:::page{template="chapter-opener"}\n## Stage 1\n:::\n`, cfg);
    expect(html).toContain('data-page-template="chapter-opener"');
  });

  it("errors when a multi-slot template's required slot is missing", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      templates: { "ad-lib": { slots: ["suggested"], template: "<div></div>" } }
    } as unknown as ProjectConfig;
    await expect(parseProject(`:::ad-lib\nno sentinels\n:::\n`, cfg)).rejects.toThrow(/missing slot/i);
  });
});
