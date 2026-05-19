import { describe, it, expect } from "vitest";
import {
  parseProjectDocument, applyEdits, serializeDocument, diffYaml,
  type Edit
} from "./document.js";

const SAMPLE = `# Project config — hand-tuned, do not clobber
page-templates:
  default:
    size: A5            # chosen for the booklet
    margin: { top: 18mm, bottom: 20mm, inner: 18mm, outer: 14mm }
  cover:
    size: A5
    margin: 0

# Brand vocabulary
design-tokens:
  color:
    ink: '#1a1a1a'
    accent: '#FFE600'   # the yellow
  size:
    body: 12pt
`;

function apply(src: string, edits: Edit[], mode: "merge" | "reset" = "merge") {
  const doc = parseProjectDocument(src);
  const changed = applyEdits(doc, edits, mode);
  return { out: serializeDocument(doc), changed };
}

describe("applyEdits — comment & key preservation", () => {
  it("preserves comments and unrelated keys when changing one value", () => {
    const { out, changed } = apply(SAMPLE, [
      { kind: "page-size", template: "default", value: { kind: "named", name: "A4" } }
    ]);
    expect(changed).toBe(1);
    expect(out).toContain("# Project config — hand-tuned, do not clobber");
    expect(out).toContain("# chosen for the booklet");
    expect(out).toContain("# Brand vocabulary");
    expect(out).toContain("# the yellow");
    expect(out).toContain("size: A4");
    expect(out).not.toContain("size: A5\n            # chosen"); // sanity
    // Untouched keys still there.
    expect(out).toContain("accent: '#FFE600'");
    expect(out).toContain("body: 12pt");
  });

  it("writes a margin object and a token without disturbing siblings", () => {
    const { out, changed } = apply(SAMPLE, [
      {
        kind: "page-margin", template: "default",
        value: { kind: "box", top: "10mm", bottom: "10mm", inner: "12mm", outer: "12mm" }
      },
      { kind: "token", category: "color", name: "accent", value: "#ff8800" }
    ]);
    expect(changed).toBe(2);
    expect(out).toContain("#ff8800");
    expect(out).toContain("top: 10mm");
    expect(out).toContain("ink: '#1a1a1a'"); // sibling untouched
    expect(out).toContain("# Brand vocabulary");
  });

  it("adds a brand-new token (key absent before)", () => {
    const { out, changed } = apply(SAMPLE, [
      { kind: "token", category: "color", name: "muted", value: "#888888" }
    ]);
    expect(changed).toBe(1);
    // yaml quotes a #-leading scalar (double-quotes for setIn-added values);
    // assert the key/value, not the quote style.
    expect(out).toMatch(/muted:\s*["']#888888["']/);
    expect(out).toContain("accent: '#FFE600'");
  });

  // The `yaml` library normalizes multi-space gaps before an inline comment
  // to a single space on ANY parse→stringify, even with zero edits. Comment
  // *content* and unrelated keys are preserved (the load-bearing guarantee);
  // only the alignment whitespace shifts. commands/tokens.ts already has
  // this exact behaviour today — it's accepted, not a regression. We assert
  // it explicitly so it's a known, intentional property.
  it("normalizes inline-comment alignment whitespace (documented yaml behaviour)", () => {
    const norm = serializeDocument(parseProjectDocument(SAMPLE));
    expect(norm).not.toBe(SAMPLE); // whitespace-only shift
    expect(norm).toContain("# chosen for the booklet"); // content survives
    expect(norm).toContain("# the yellow");
    expect(norm.replace(/ +#/g, " #")).toBe(SAMPLE.replace(/ +#/g, " #"));
  });
});

describe("applyEdits — merge semantics", () => {
  // "No-op" means: zero keys changed, and output is stable under re-apply —
  // NOT byte-identical to the raw input (yaml reflows comment whitespace on
  // the first round-trip regardless; see the documented behaviour above).
  const NORM = serializeDocument(parseProjectDocument(SAMPLE));

  it("undefined value = unchanged field = no-op (Enter-through)", () => {
    const { out, changed } = apply(SAMPLE, [
      { kind: "page-size", template: "default", value: undefined },
      { kind: "token", category: "color", name: "ink", value: undefined }
    ]);
    expect(changed).toBe(0);
    expect(out).toBe(NORM);
  });

  it("re-applying the current value is a no-op in merge mode", () => {
    const { out, changed } = apply(SAMPLE, [
      { kind: "page-size", template: "default", value: { kind: "named", name: "A5" } },
      { kind: "token", category: "size", name: "body", value: "12pt" }
    ]);
    expect(changed).toBe(0);
    expect(out).toBe(NORM);
  });

  it("changes only the fields whose value differs (partial replace)", () => {
    const { out, changed } = apply(SAMPLE, [
      { kind: "page-size", template: "default", value: { kind: "named", name: "A5" } }, // same
      { kind: "token", category: "color", name: "accent", value: "#000000" }            // diff
    ]);
    expect(changed).toBe(1);
    expect(out).toContain("#000000");
    expect(out).toContain("size: A5");
  });
});

describe("applyEdits — idempotence property", () => {
  it("applying the same answers twice yields an empty diff", () => {
    const answers: Edit[] = [
      { kind: "page-size", template: "default", value: { kind: "custom", width: "200mm", height: "260mm" } },
      { kind: "page-margin", template: "cover", value: { kind: "zero" } },
      { kind: "token", category: "color", name: "accent", value: "#abcdef" }
    ];
    const first = apply(SAMPLE, answers);
    const second = apply(first.out, answers);
    expect(second.changed).toBe(0);
    expect(diffYaml(first.out, second.out)).toBe("");
  });
});

describe("applyEdits — reset mode", () => {
  it("overwrites even equal values but still preserves comments", () => {
    const { out } = apply(
      SAMPLE,
      [{ kind: "page-size", template: "default", value: { kind: "named", name: "A5" } }],
      "reset"
    );
    // Value identical, but comments survive (only the mapped scalar is reset).
    expect(out).toContain("# chosen for the booklet");
    expect(out).toContain("# Project config — hand-tuned, do not clobber");
    expect(out).toContain("size: A5");
  });
});

describe("diffYaml", () => {
  it("is empty for identical input", () => {
    expect(diffYaml(SAMPLE, SAMPLE)).toBe("");
  });

  it("shows - old / + new for a changed line with context", () => {
    const after = SAMPLE.replace("size: A5            # chosen for the booklet", "size: A4");
    const d = diffYaml(SAMPLE, after);
    expect(d).toMatch(/^- .*size: A5/m);
    expect(d).toMatch(/^\+ .*size: A4/m);
    // context lines are space-prefixed, not +/-
    expect(d).toMatch(/^ {2}\S/m);
  });

  it("handles pure additions (new token line)", () => {
    const { out } = apply(SAMPLE, [
      { kind: "token", category: "size", name: "h1", value: "24pt" }
    ]);
    const d = diffYaml(SAMPLE, out);
    expect(d).toMatch(/^\+ .*h1: 24pt/m);
  });
});
