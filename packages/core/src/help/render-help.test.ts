import { describe, it, expect } from "vitest";
import { renderHelp } from "./render-help.js";

describe("renderHelp", () => {
  it("renders the bundled user guide to HTML", async () => {
    const result = await renderHelp();
    expect(result.html).toContain("Tender User Guide");
    // remark-gfm is in the pipeline, so the lint-codes table in the guide
    // must render as <table> rather than literal pipes.
    expect(result.html).toContain("<table>");
  });
});
