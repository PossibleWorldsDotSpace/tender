import { describe, it, expect } from "vitest";
import { cleanText } from "./index.js";

// NBSP escape so test fixtures can include them unambiguously.
const NBSP = " ";

describe("cleanText", () => {
  it("returns input unchanged when no rules fire", async () => {
    const r = await cleanText("plain prose\n");
    expect(r.output).toBe("plain prose\n");
    expect(r.changes).toEqual([]);
  });

  it("applies BOM and CRLF rules in order", async () => {
    const src = "﻿hello\r\nworld\r\n";
    const r = await cleanText(src);
    expect(r.output).toBe("hello\nworld\n");
    expect(r.changes.map(c => c.code).sort()).toEqual(
      ["clean/bom", "clean/line-endings"]
    );
  });

  it("applies zero-width and trailing-whitespace rules", async () => {
    const src = `hello​ world   \nmore`;
    const r = await cleanText(src);
    expect(r.output).toBe("hello world\nmore");
  });

  it("does not run typography when option is off", async () => {
    const src = `She said "hello".`;
    const r = await cleanText(src, { typography: false });
    expect(r.output).toBe(src);
    expect(r.changes.find(c => c.code === "clean/typography")).toBeUndefined();
  });

  it("runs typography when option is true", async () => {
    const src = `She said "hello".`;
    const r = await cleanText(src, { typography: true });
    expect(r.output).toContain("“"); // “
    expect(r.changes.find(c => c.code === "clean/typography")).toBeDefined();
  });

  it("returns one change entry per rule that fired", async () => {
    const src = `﻿hello​ world`;
    const r = await cleanText(src);
    expect(r.changes.map(c => c.code).sort()).toEqual(
      ["clean/bom", "clean/zero-width"]
    );
  });

  it("is idempotent — running twice produces the same output", async () => {
    const src = `﻿hello "world"  \r\nmore`;
    const once = (await cleanText(src, { typography: true })).output;
    const twice = (await cleanText(once, { typography: true })).output;
    expect(twice).toBe(once);
  });

  it("kitchen-sink Word-paste fixture", async () => {
    // BOM + zero-width + NBSP + soft hyphen + trailing whitespace +
    // CRLF + smart-typography candidates.
    const src =
      `﻿She said "hello"​--\r\n` +
      `she pau­sed.   \nNext${NBSP}line.`;
    const r = await cleanText(src, { typography: true });
    // No paste artifacts in output.
    expect(r.output).not.toMatch(/[﻿​­ \r]/);
    // Smart typography applied.
    expect(r.output).toContain("“"); // “
    expect(r.output).toContain("—"); // —
    // Multiple rules fired.
    expect(r.changes.length).toBeGreaterThanOrEqual(5);
  });
});
