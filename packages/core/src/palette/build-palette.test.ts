import { describe, it, expect } from "vitest";
import { buildPalette } from "./build-palette.js";
import type { ProjectConfig } from "../config/schema.js";

describe("buildPalette", () => {
  it("produces a tile for each declared component", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        callout: { tag: "aside", class: "callout", attrs: ["variant"] }
      }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    expect(palette.components.length).toBe(1);
    const c = palette.components[0]!;
    expect(c.name).toBe("callout");
    expect(c.kind).toBe("component");
    expect(c.meta.tag).toBe("aside");
    expect(c.renders[0]?.html).toContain('<aside');
    expect(c.renders[0]?.html).toContain('class="callout"');
    expect(c.renders[0]?.snippet).toContain(":::callout");
  });

  it("uses palette overrides when declared", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      components: {
        callout: {
          tag: "aside", class: "callout", attrs: ["variant"],
          palette: {
            attrs: { variant: "warning" },
            body: "Watch your step.",
            variants: [{ attrs: { variant: "info" }, body: "Info." }]
          }
        }
      }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    const c = palette.components[0]!;
    expect(c.renders.length).toBe(2);
    expect(c.renders[0]?.html).toContain('data-variant="warning"');
    expect(c.renders[0]?.html).toContain('Watch your step');
    expect(c.renders[1]?.html).toContain('data-variant="info"');
    expect(c.renders[1]?.label).toBe('variant 1');
  });

  it("produces a tile for each declared template", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } },
      templates: {
        row: {
          params: ["label"],
          template: '<div class="row"><span>{{label}}</span><div>{{{body}}}</div></div>'
        }
      }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    expect(palette.templates.length).toBe(1);
    const t = palette.templates[0]!;
    expect(t.renders[0]?.html).toContain('class="row"');
    expect(t.renders[0]?.snippet).toMatch(/^:::row/);
  });

  it("includes a fixed typography specimen", async () => {
    const cfg = {
      "page-templates": { default: { size: "A5", margin: 0 as const } }
    } as unknown as ProjectConfig;
    const palette = await buildPalette(cfg);
    const ids = palette.typography.map(t => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["h1", "h2", "h3", "h4", "p", "ul", "ol", "blockquote", "pre", "hr"])
    );
  });
});
