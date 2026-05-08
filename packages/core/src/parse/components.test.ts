import { describe, it, expect } from "vitest";
import { parseProject } from "./project-parser.js";
import type { ProjectConfig } from "../config/schema.js";

const config = {
  "page-templates": { default: { size: "A5", margin: 0 as const } },
  components: {
    callout: { tag: "aside", class: "callout", attrs: ["variant"] },
    "stage-direction": { tag: "span", class: "stage-direction", inline: true }
  }
} as unknown as ProjectConfig;

describe("component resolution", () => {
  it("rewrites a known block component", async () => {
    const html = await parseProject(":::callout{variant=warning}\nWatch out.\n:::\n", config);
    expect(html).toContain('<aside class="callout" data-variant="warning">');
    expect(html).toContain("Watch out.");
  });

  it("rewrites an inline component", async () => {
    const html = await parseProject("Note :stage-direction[whispers] here.", config);
    expect(html).toContain('<span class="stage-direction">whispers</span>');
  });

  it("errors on unknown component name", async () => {
    await expect(parseProject(":::unknown\nhi\n:::\n", config)).rejects.toThrow(/unknown component/i);
  });
});
