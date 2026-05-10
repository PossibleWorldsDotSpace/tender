import { describe, it, expect } from "vitest";
import { normalizeBom } from "./bom.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeBom", () => {
  it("strips a leading BOM", () => {
    const r = normalizeBom("﻿hello");
    expect(r.output).toBe("hello");
    expect(r.change?.count).toBe(1);
  });

  it("does nothing when there's no BOM", () => {
    const r = normalizeBom("hello");
    expect(r.output).toBe("hello");
    expect(r.change).toBeNull();
  });

  it("does not strip a non-leading BOM", () => {
    // A BOM mid-text is technically a zero-width-non-breaking-space; the
    // zero-width rule handles it. BOM rule only strips leading.
    const r = normalizeBom("hello﻿world");
    expect(r.output).toBe("hello﻿world");
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeBom(s).output;
    expectIdempotent(fn, "﻿hello");
    expectIdempotent(fn, "no bom");
    expectIdempotent(fn, "");
  });
});
