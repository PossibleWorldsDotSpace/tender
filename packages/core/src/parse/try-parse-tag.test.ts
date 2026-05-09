import { describe, it, expect } from "vitest";
import { tryParseTag } from "./try-parse-tag.js";

describe("tryParseTag — openers", () => {
  it("parses a bare opener", () => {
    const t = tryParseTag("<row>", 0);
    expect(t).toEqual({
      kind: "open",
      name: "row",
      attrs: [],
      start: 0,
      end: 5
    });
  });

  it("parses an opener with one double-quoted attribute", () => {
    const t = tryParseTag(`<row label="45 min">`, 0);
    expect(t?.kind).toBe("open");
    expect(t?.name).toBe("row");
    expect(t?.attrs).toEqual([
      {
        name: "label",
        value: "45 min",
        nameStart: 5,
        nameEnd: 10,
        valueStart: 12, // just past the opening quote
        valueEnd: 19    // includes the closing quote (start of next char would be `>`)
      }
    ]);
    expect(t?.end).toBe(20);
  });

  it("parses an opener with one single-quoted attribute", () => {
    const t = tryParseTag(`<row label='single quotes'>`, 0);
    expect(t?.attrs).toHaveLength(1);
    expect(t?.attrs[0]?.value).toBe("single quotes");
  });

  it("parses an opener with one unquoted attribute", () => {
    const t = tryParseTag(`<row icon=clock>`, 0);
    expect(t?.attrs).toHaveLength(1);
    const a = t!.attrs[0]!;
    expect(a.name).toBe("icon");
    expect(a.value).toBe("clock");
    expect(a.valueStart).toBe(10);
    expect(a.valueEnd).toBe(15);
  });

  it("parses an opener with multiple mixed attributes", () => {
    const t = tryParseTag(`<row label="x" icon=clock no-break>`, 0);
    expect(t?.kind).toBe("open");
    expect(t?.attrs.map(a => [a.name, a.value])).toEqual([
      ["label", "x"],
      ["icon", "clock"],
      ["no-break", "true"]
    ]);
  });

  it("treats a name-only attribute as boolean (value=true)", () => {
    const t = tryParseTag(`<row no-break>`, 0);
    expect(t?.attrs[0]?.name).toBe("no-break");
    expect(t?.attrs[0]?.value).toBe("true");
    expect(t?.attrs[0]?.valueStart).toBeUndefined();
    expect(t?.attrs[0]?.valueEnd).toBeUndefined();
  });

  it("preserves > inside quoted attribute values", () => {
    const t = tryParseTag(`<row label="more > less">`, 0);
    expect(t?.attrs[0]?.value).toBe("more > less");
    expect(t?.kind).toBe("open");
  });

  it("preserves spaces and special chars inside double-quoted values", () => {
    const t = tryParseTag(`<x a="hello world & co.">`, 0);
    expect(t?.attrs[0]?.value).toBe("hello world & co.");
  });

  it("preserves spaces inside single-quoted values", () => {
    const t = tryParseTag(`<x a='it"s ok'>`, 0);
    expect(t?.attrs[0]?.value).toBe(`it"s ok`);
  });

  it("accepts trailing whitespace before the closing >", () => {
    const t = tryParseTag(`<row label="x" >`, 0);
    expect(t?.kind).toBe("open");
    expect(t?.attrs).toHaveLength(1);
  });

  it("accepts hyphenated attribute names", () => {
    const t = tryParseTag(`<row no-break="true" data-key="v">`, 0);
    expect(t?.attrs.map(a => a.name)).toEqual(["no-break", "data-key"]);
  });

  it("accepts hyphenated tag names", () => {
    const t = tryParseTag(`<stage-direction>`, 0);
    expect(t?.name).toBe("stage-direction");
  });
});

describe("tryParseTag — closers", () => {
  it("parses a closer", () => {
    const t = tryParseTag("</row>", 0);
    expect(t).toEqual({
      kind: "close",
      name: "row",
      attrs: [],
      start: 0,
      end: 6
    });
  });

  it("accepts whitespace before the closing > on a closer", () => {
    const t = tryParseTag("</row >", 0);
    expect(t?.kind).toBe("close");
    expect(t?.name).toBe("row");
    expect(t?.end).toBe(7);
  });
});

describe("tryParseTag — self-close", () => {
  it("parses <name/>", () => {
    const t = tryParseTag("<x/>", 0);
    expect(t?.kind).toBe("self-close");
    expect(t?.name).toBe("x");
    expect(t?.end).toBe(4);
  });

  it("parses <name />", () => {
    const t = tryParseTag("<x />", 0);
    expect(t?.kind).toBe("self-close");
    expect(t?.end).toBe(5);
  });

  it("parses <name attr='v'/>", () => {
    const t = tryParseTag(`<row label="x"/>`, 0);
    expect(t?.kind).toBe("self-close");
    expect(t?.attrs[0]?.value).toBe("x");
  });

  it("does not self-close when an unquoted value swallows the slash", () => {
    // Per the grammar, [^\s>]+ consumes `val/`, leaving a normal opener with
    // attr label="val/". This matches HTML5 attribute parsing exactly.
    const t = tryParseTag(`<row label=val/>`, 0);
    expect(t?.kind).toBe("open");
    expect(t?.attrs[0]?.value).toBe("val/");
  });

  it("self-closes when there's whitespace before the slash", () => {
    const t = tryParseTag(`<row label=val />`, 0);
    expect(t?.kind).toBe("self-close");
    expect(t?.attrs[0]?.value).toBe("val");
  });
});

describe("tryParseTag — null returns", () => {
  it("returns null when the source doesn't start with <", () => {
    expect(tryParseTag("hello", 0)).toBeNull();
  });

  it("returns null for < not followed by a letter", () => {
    expect(tryParseTag("< 3 ", 0)).toBeNull();
    expect(tryParseTag("<3", 0)).toBeNull();
    expect(tryParseTag("<", 0)).toBeNull();
  });

  it("returns null when there is no closing >", () => {
    expect(tryParseTag("<row", 0)).toBeNull();
    expect(tryParseTag(`<row label="x"`, 0)).toBeNull();
  });

  it("returns null when a quoted value is unclosed", () => {
    expect(tryParseTag(`<row label="x>`, 0)).toBeNull();
    expect(tryParseTag(`<row label='x>`, 0)).toBeNull();
  });

  it("returns null when an unquoted value is empty", () => {
    expect(tryParseTag(`<row label= >`, 0)).toBeNull();
  });

  it("returns null when attributes are not whitespace-separated", () => {
    expect(tryParseTag(`<row a="1"b="2">`, 0)).toBeNull();
  });

  it("returns null on a bare = following the tag name", () => {
    expect(tryParseTag(`<row=>`, 0)).toBeNull();
  });

  it("returns null on </ with no name", () => {
    expect(tryParseTag(`</>`, 0)).toBeNull();
    expect(tryParseTag(`</ row>`, 0)).toBeNull();
  });

  it("returns null when the input ends mid-attribute", () => {
    expect(tryParseTag(`<row a=`, 0)).toBeNull();
    expect(tryParseTag(`<row a`, 0)).toBeNull();
  });

  it("returns null on attempted attributes inside a closer", () => {
    // Closers don't take attributes.
    expect(tryParseTag(`</row foo="x">`, 0)).toBeNull();
  });
});

describe("tryParseTag — offsets and partial input", () => {
  it("starts parsing at the supplied offset", () => {
    const src = "Hello <row>world</row>";
    const t = tryParseTag(src, 6);
    expect(t?.kind).toBe("open");
    expect(t?.name).toBe("row");
    expect(t?.start).toBe(6);
    expect(t?.end).toBe(11);
  });

  it("attribute name and value offsets are absolute", () => {
    const src = `Hello <row label="45 min">world`;
    const t = tryParseTag(src, 6);
    const a = t!.attrs[0]!;
    expect(src.slice(a.nameStart, a.nameEnd)).toBe("label");
    // valueStart points just past the opening quote; valueEnd just past the
    // closing quote. Slicing nameEnd..valueEnd captures `="45 min"`.
    expect(src.slice(a.valueStart, a.valueEnd! - 1)).toBe("45 min");
  });

  it("does not consume past the end position", () => {
    const src = "<row>more text after";
    const t = tryParseTag(src, 0);
    expect(t?.end).toBe(5);
  });
});
