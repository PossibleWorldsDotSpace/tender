import { describe, it, expect } from "vitest";
import { ProjectConfig } from "./schema.js";

describe("ProjectConfig", () => {
  it("parses a minimal valid config", () => {
    const config = ProjectConfig.parse({
      "page-templates": {
        default: {
          size: "A5",
          margin: { top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm" }
        }
      }
    });
    expect(config["page-templates"].default!.size).toBe("A5");
  });

  it("rejects a config with no default page template", () => {
    expect(() =>
      ProjectConfig.parse({ "page-templates": { other: { size: "A5", margin: {} } } })
    ).toThrow(/default/);
  });

  it("parses a wrapper-style component definition", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      components: {
        callout: { tag: "aside", class: "callout", params: ["variant"] }
      }
    });
    expect(c.components?.callout?.tag).toBe("aside");
    expect(c.components?.callout?.params).toEqual(["variant"]);
  });

  it("parses a block-template component definition", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      components: {
        row: {
          params: ["label", "icon"],
          template: "<div class=\"row\">{{{body}}}</div>"
        },
        "ad-lib": {
          slots: ["suggested"],
          template: "<div>{{{suggested}}}</div>"
        }
      }
    });
    expect(c.components?.row?.params).toEqual(["label", "icon"]);
    expect(c.components?.["ad-lib"]?.slots).toEqual(["suggested"]);
    expect(c.components?.row?.template).toContain("{{{body}}}");
  });

  it("rejects a component that declares neither tag nor template", () => {
    expect(() =>
      ProjectConfig.parse({
        "page-templates": { default: { size: "A5", margin: 0 } },
        components: { broken: { params: ["x"] } }
      })
    ).toThrow(/either `tag`.*or `template`/);
  });

  it("rejects a component that declares both tag and template", () => {
    expect(() =>
      ProjectConfig.parse({
        "page-templates": { default: { size: "A5", margin: 0 } },
        components: {
          confused: { tag: "div", template: "<div>{{{body}}}</div>" }
        }
      })
    ).toThrow(/cannot declare both/);
  });

  it("rejects a wrapper component that declares slots", () => {
    expect(() =>
      ProjectConfig.parse({
        "page-templates": { default: { size: "A5", margin: 0 } },
        components: {
          weird: { tag: "div", slots: ["a"] }
        }
      })
    ).toThrow(/wrapper components.*cannot declare `slots`/);
  });

  it("parses headers/footers and verso/recto variants", () => {
    const c = ProjectConfig.parse({
      "page-templates": {
        default: {
          size: "A5", margin: 0,
          headers: {
            "left-page":  { left: "{page}", right: "{chapter}" },
            "right-page": { left: "{title}", right: "{page}" }
          },
          footers: { center: "{page}" }
        },
        "chapter-opener": {
          size: "A5", margin: 0,
          headers: "none",
          "headers-rest": { left: "{chapter}", right: "{title}" }
        }
      }
    });
    expect(c["page-templates"].default!.headers).toBeTruthy();
    expect(c["page-templates"]["chapter-opener"]!.headers).toBe("none");
  });

  it("parses typography and fonts sections", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      typography: {
        lang: "en-GB",
        hyphenation: {
          enabled: true,
          "min-word-length": 6,
          "min-chars-before": 3,
          "min-chars-after": 3,
          "max-consecutive-hyphens": 2
        },
        orphans: 2,
        widows: 2
      },
      fonts: [
        { family: "Display", file: "MackinacPro-Book.woff2", weight: 400, style: "normal" },
        { family: "Display", file: "MackinacPro-BookItalic.woff2", weight: 400, style: "italic" }
      ]
    });
    expect(c.typography?.lang).toBe("en-GB");
    expect(c.typography?.hyphenation?.["min-word-length"]).toBe(6);
    expect(c.fonts?.[0]?.family).toBe("Display");
  });

  it("accepts a palette block on a wrapper component", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      components: {
        callout: {
          tag: "aside",
          class: "callout",
          params: ["variant"],
          palette: {
            attrs: { variant: "warning" },
            body: "Watch your step.",
            variants: [
              { attrs: { variant: "info" }, body: "Info." }
            ]
          }
        }
      }
    });
    expect(c.components?.callout?.palette?.attrs?.variant).toBe("warning");
    expect(c.components?.callout?.palette?.variants?.[0]?.body).toBe("Info.");
  });

  it("accepts a palette block on a block-template component with slots", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      components: {
        "ad-lib": {
          slots: ["suggested"],
          template: "<div>{{{suggested}}}</div>",
          palette: {
            slots: { suggested: "Hello." },
            variants: [{ slots: { suggested: "Goodbye." } }]
          }
        }
      }
    });
    expect(c.components?.["ad-lib"]?.palette?.slots?.suggested).toBe("Hello.");
  });

  it("parses a render.timeout-ms override", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      render: { "timeout-ms": 180000 }
    });
    expect(c.render?.["timeout-ms"]).toBe(180000);
  });

  it("rejects a non-positive render.timeout-ms", () => {
    expect(() =>
      ProjectConfig.parse({
        "page-templates": { default: { size: "A5", margin: 0 } },
        render: { "timeout-ms": 0 }
      })
    ).toThrow();
  });

  it("accepts an inline-shortcuts mapping with allowlisted characters", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      "inline-shortcuts": { "@": "speaker-name", "%": "yellow-tag" }
    });
    expect(c["inline-shortcuts"]?.["@"]).toBe("speaker-name");
    expect(c["inline-shortcuts"]?.["%"]).toBe("yellow-tag");
  });

  it("accepts § as an allowlisted shortcut character", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      "inline-shortcuts": { "§": "section-mark" }
    });
    expect(c["inline-shortcuts"]?.["§"]).toBe("section-mark");
  });

  it("rejects shortcut characters outside the allowlist", () => {
    expect(() =>
      ProjectConfig.parse({
        "page-templates": { default: { size: "A5", margin: 0 } },
        "inline-shortcuts": { "*": "stage-direction" }
      })
    ).toThrow(/@ % \| §/);
  });

  it("rejects multi-character shortcut keys", () => {
    expect(() =>
      ProjectConfig.parse({
        "page-templates": { default: { size: "A5", margin: 0 } },
        "inline-shortcuts": { "@@": "x" }
      })
    ).toThrow();
  });

  it("accepts a clean.typography setting", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      clean: { typography: "smart" }
    });
    expect(c.clean?.typography).toBe("smart");
  });

  it("accepts clean: {} as the no-op default", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      clean: {}
    });
    expect(c.clean?.typography).toBeUndefined();
  });

  it("rejects unknown values for clean.typography", () => {
    expect(() =>
      ProjectConfig.parse({
        "page-templates": { default: { size: "A5", margin: 0 } },
        clean: { typography: "yes" }
      })
    ).toThrow();
  });
});
