import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";

describe("yaml round-trip sanity", () => {
  it("preserves comments when modifying a value", () => {
    const src = `
# top comment
page-templates:
  default: { size: A4, margin: 0 }
design-tokens:
  color:
    ink: '#000'  # current ink
`;
    const doc = parseDocument(src);
    doc.setIn(["design-tokens", "color", "ink"], "#1a1a1a");
    const out = doc.toString();
    expect(out).toContain("# top comment");
    expect(out).toContain("# current ink");
    expect(out).toMatch(/ink:\s+["']?#1a1a1a/);
  });
});
