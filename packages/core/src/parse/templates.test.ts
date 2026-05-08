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
});
