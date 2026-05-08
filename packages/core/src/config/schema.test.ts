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

  it("parses a component definition", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      components: {
        callout: { tag: "aside", class: "callout", attrs: ["variant"] }
      }
    });
    expect(c.components?.callout?.tag).toBe("aside");
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

  it("accepts a palette block on a component", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      components: {
        callout: {
          tag: "aside",
          class: "callout",
          attrs: ["variant"],
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

  it("accepts a palette block on a template with params and slots", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      templates: {
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
    expect(c.templates?.["ad-lib"]?.palette?.slots?.suggested).toBe("Hello.");
  });

  it("parses a template definition with slots and params", () => {
    const c = ProjectConfig.parse({
      "page-templates": { default: { size: "A5", margin: 0 } },
      templates: {
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
    expect(c.templates?.row?.params).toEqual(["label", "icon"]);
    expect(c.templates?.["ad-lib"]?.slots).toEqual(["suggested"]);
  });
});
