import { describe, it, expect } from "vitest";
import { confirm } from "./prompt.js";

describe("confirm", () => {
  const reader = (answer: string) => () => Promise.resolve(answer);

  it("returns the default on an empty answer (Enter)", async () => {
    expect(await confirm("Go?", true, reader(""))).toBe(true);
    expect(await confirm("Go?", false, reader(""))).toBe(false);
    expect(await confirm("Go?", true, reader("  \n"))).toBe(true);
  });

  it("treats y / yes (any case, surrounding space) as yes", async () => {
    for (const a of ["y", "Y", "yes", "YES", "  y \n", "Yes"]) {
      expect(await confirm("Go?", false, reader(a))).toBe(true);
    }
  });

  it("treats anything else as no", async () => {
    for (const a of ["n", "no", "nope", "x", "1", "yeah"]) {
      expect(await confirm("Go?", true, reader(a))).toBe(false);
    }
  });
});
