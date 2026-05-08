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
