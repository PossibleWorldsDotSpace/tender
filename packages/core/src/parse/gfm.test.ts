import { describe, it, expect } from "vitest";
import { parseProject } from "./project-parser.js";
import type { ProjectConfig } from "../config/schema.js";

const baseConfig = {
  "page-templates": { default: { size: "A5", margin: 0 as const } }
} as unknown as ProjectConfig;

const TABLE = `| Mechanism | Purpose | Page |
| ---- | ---- | ----: |
| Timeline | Linking past to present | 12 |
| Map | Where things are | |
`;

/** A <table> with the expected header/body cells, ignoring attribute noise. */
function expectTable(html: string): void {
  expect(html).toContain("<table>");
  expect(html).toMatch(/<thead>/);
  expect(html).toMatch(/<th[^>]*>Mechanism<\/th>/);
  expect(html).toMatch(/<th[^>]*>Purpose<\/th>/);
  expect(html).toMatch(/<td[^>]*>Timeline<\/td>/);
  expect(html).toMatch(/<td[^>]*>Linking past to present<\/td>/);
  // Literal pipe characters from the source must be gone.
  expect(html).not.toContain("| Mechanism | Purpose | Page |");
}

describe("GFM support (remark-gfm)", () => {
  it("parses a top-level table to real <table> markup", async () => {
    const { html } = await parseProject(TABLE, baseConfig);
    expectTable(html);
    // The `----:` delimiter makes the last column right-aligned.
    expect(html).toMatch(/<th[^>]*(align="right"|text-align:\s*right)[^>]*>Page<\/th>/);
  });

  it("parses a table inside a wrapper component body", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: { box: { tag: "div", class: "box" } }
    } as unknown as ProjectConfig;
    const { html } = await parseProject(`:::box\n${TABLE}:::\n`, cfg);
    expect(html).toContain('<div class="box">');
    expectTable(html);
  });

  it("parses a table inside a block-template component body", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: { panel: { template: `<section class="panel">{{{body}}}</section>` } }
    } as unknown as ProjectConfig;
    const { html } = await parseProject(`:::panel\n${TABLE}:::\n`, cfg);
    expect(html).toContain('<section class="panel">');
    expectTable(html);
  });

  it("parses a table inside a multi-slot component slot", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        "two-up": { slots: ["aside"], template: `<div class="two-up"><div class="a">{{{aside}}}</div></div>` }
      }
    } as unknown as ProjectConfig;
    const { html } = await parseProject(`:::two-up\n@@ aside\n\n${TABLE}:::\n`, cfg);
    expect(html).toContain('class="two-up"');
    expectTable(html);
  });

  it("parses strikethrough", async () => {
    const { html } = await parseProject("Done with ~~the old way~~.\n", baseConfig);
    expect(html).toContain("<del>the old way</del>");
  });

  it("parses footnotes", async () => {
    const { html } = await parseProject(`A claim.[^1]\n\n[^1]: The supporting note.\n`, baseConfig);
    expect(html).toMatch(/<sup>/);
    expect(html).toContain('class="footnotes"');
    expect(html).toContain("The supporting note.");
    expect(html).not.toContain("[^1]:");
  });

  it("parses GFM task-list items", async () => {
    const { html } = await parseProject(`- [x] shipped\n- [ ] pending\n`, baseConfig);
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toMatch(/<input[^>]*checked/);
  });

  it("does not mistake a table delimiter row for a directive", async () => {
    // Leading `:` in an aligned delimiter cell (`:----`) must not trip
    // remark-directive, which runs alongside remark-gfm in the pipeline.
    const aligned = `| A | B |\n| :--- | ---: |\n| 1 | 2 |\n`;
    const { html } = await parseProject(aligned, baseConfig);
    expect(html).toContain("<table>");
    expect(html).toMatch(/<td[^>]*>1<\/td>/);
  });
});
