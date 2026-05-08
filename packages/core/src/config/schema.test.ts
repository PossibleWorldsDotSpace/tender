import { describe, it, expect } from "vitest";
import { ProjectConfig } from "./schema.ts";

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
    expect(config["page-templates"].default.size).toBe("A5");
  });

  it("rejects a config with no default page template", () => {
    expect(() =>
      ProjectConfig.parse({ "page-templates": { other: { size: "A5", margin: {} } } })
    ).toThrow(/default/);
  });
});
