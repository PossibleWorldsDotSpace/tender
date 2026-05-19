import { describe, it, expect } from "vitest";
import {
  initTokenPicker, reduce, render, collectEdits,
  contrastRatio, isValidIdent,
  type TokenPickerState, type KeyEvent
} from "./token-picker.js";
import type { ProjectConfig } from "@tender/core";

const CONFIG = {
  "page-templates": { default: { size: "A5", margin: 0 } },
  "design-tokens": {
    color: { ink: "#1a1a1a", page: "#ffffff", accent: "#FFE600" },
    size: { body: 12, h1: "24pt" }
  }
} as unknown as ProjectConfig;

function drive(s: TokenPickerState, keys: KeyEvent[]): TokenPickerState {
  return keys.reduce((st, k) => reduce(st, k), s);
}
const down: KeyEvent = { name: "down" };
const up: KeyEvent = { name: "up" };
const enter: KeyEvent = { name: "return" };
const esc: KeyEvent = { name: "escape" };
const bs: KeyEvent = { name: "backspace" };
const ch = (c: string): KeyEvent => ({ str: c });
const type = (s: string): KeyEvent[] => s.split("").map(ch);

describe("initTokenPicker", () => {
  it("flattens design-tokens into rows in declaration order", () => {
    const s = initTokenPicker(CONFIG);
    expect(s.rows.map(r => `${r.category}.${r.name}`)).toEqual([
      "color.ink", "color.page", "color.accent", "size.body", "size.h1"
    ]);
    // numbers are kept as string form for display/diff
    expect(s.rows.find(r => r.name === "body")!.value).toBe("12");
  });

  it("handles a project with no design-tokens", () => {
    const s = initTokenPicker({
      "page-templates": { default: { size: "A5", margin: 0 } }
    } as unknown as ProjectConfig);
    expect(s.rows).toHaveLength(0);
    const out = render(s);
    expect(out).toContain("Set basic design tokens here");
    expect(out).toMatch(/Press a to add your first token/);
  });
});

describe("reduce — browse & edit", () => {
  it("edits a value and emits a token edit", () => {
    const s0 = initTokenPicker(CONFIG); // cursor on color.ink
    let s = drive(s0, [enter]); // edit mode, replace-on-type so buffer starts empty
    expect(s.phase).toBe("edit");
    expect(s.buffer).toBe("");
    s = drive(s, [...type("#000000"), enter]);
    expect(s.phase).toBe("browse");
    expect(collectEdits(s)).toContainEqual({
      kind: "token", category: "color", name: "ink", value: "#000000"
    });
  });

  it("↵ on empty buffer keeps the current value (replace-on-type)", () => {
    const s0 = initTokenPicker(CONFIG); // cursor on color.ink (#1a1a1a)
    const s = drive(s0, [enter, enter]); // enter edit, immediately enter again
    expect(s.phase).toBe("browse");
    // No edit emitted — the value is unchanged.
    expect(collectEdits(s).filter(e => e.kind === "token" && e.name === "ink")).toEqual([]);
    // The row's value is still the original.
    expect(s.rows.find(r => r.name === "ink")!.value).toBe("#1a1a1a");
  });

  it("normalizes a 3-digit hex on commit for the color category", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = drive(s0, [enter, ...Array(7).fill(bs), ...type("#abc"), enter]);
    expect(s.rows[0]!.value).toBe("#aabbcc");
  });

  it("does not hex-normalize non-color categories", () => {
    const s0 = initTokenPicker(CONFIG);
    // move to size.body (row index 3)
    let s = drive(s0, [down, down, down, enter]);
    s = drive(s, [...Array(2).fill(bs), ...type("14pt"), enter]);
    expect(s.rows[3]!.value).toBe("14pt");
  });

  it("Esc in edit cancels the edit, keeping the prior value", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = drive(s0, [enter, ...type("zzz")]);
    s = reduce(s, esc);
    expect(s.phase).toBe("browse");
    expect(s.rows[0]!.value).toBe("#1a1a1a");
    expect(collectEdits(s)).toEqual([]);
  });

  it("coerces clean numeric strings back to numbers in edits", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = drive(s0, [down, down, down, enter]); // size.body = "12"
    s = drive(s, [...Array(2).fill(bs), ...type("16"), enter]);
    expect(collectEdits(s)).toContainEqual({
      kind: "token", category: "size", name: "body", value: 16
    });
  });

  it("clamps cursor and ignores Enter on an empty list", () => {
    const empty = initTokenPicker({
      "page-templates": { default: { size: "A5", margin: 0 } }
    } as unknown as ProjectConfig);
    expect(drive(empty, [up, up]).cursor).toBe(0);
    expect(reduce(empty, enter).phase).toBe("browse"); // no crash
  });
});

describe("reduce — add a new token", () => {
  it("walks category → name → value and appends a row", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = reduce(s0, ch("a"));
    expect(s.phase).toBe("add");
    s = drive(s, [...type("space"), enter, ...type("gutter"), enter, ...type("8mm"), enter]);
    expect(s.phase).toBe("browse");
    const added = s.rows.find(r => r.category === "space" && r.name === "gutter");
    expect(added).toMatchObject({ value: "8mm", added: true });
    expect(collectEdits(s)).toContainEqual({
      kind: "token", category: "space", name: "gutter", value: "8mm"
    });
  });

  it("rejects an invalid category ident and stays on the step", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = reduce(s0, ch("a"));
    s = drive(s, [...type("Color"), enter]); // capital → invalid
    expect(s.add.step).toBe("category");
    expect(s.add.error).toMatch(/category must be lowercase/);
  });

  it("rejects a duplicate category.name", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = reduce(s0, ch("a"));
    s = drive(s, [...type("color"), enter, ...type("ink"), enter]);
    expect(s.add.step).toBe("name");
    expect(s.add.error).toMatch(/already exists/);
  });

  it("normalizes a hex value when the new token is in color", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = reduce(s0, ch("a"));
    s = drive(s, [...type("color"), enter, ...type("muted"), enter, ...type("#abc"), enter]);
    expect(s.rows.find(r => r.name === "muted")!.value).toBe("#aabbcc");
  });

  it("Esc abandons the add sub-flow without adding a row", () => {
    const s0 = initTokenPicker(CONFIG);
    const n = s0.rows.length;
    let s = drive(s0, [ch("a"), ...type("foo"), esc]);
    expect(s.phase).toBe("browse");
    expect(s.rows).toHaveLength(n);
  });
});

describe("idempotence (slice-1 contract at the screen level)", () => {
  it("browsing without edits yields an empty Edit[]", () => {
    const s0 = initTokenPicker(CONFIG);
    const s = drive(s0, [down, down, up, ch("s")]);
    expect(s.phase).toBe("confirm");
    expect(collectEdits(s)).toEqual([]);
  });

  it("editing a value back to its original yields no edit", () => {
    const s0 = initTokenPicker(CONFIG);
    let s = drive(s0, [enter, ...Array(7).fill(bs), ...type("#1a1a1a"), enter]);
    expect(collectEdits(s)).toEqual([]);
  });
});

describe("reduce — confirm phase", () => {
  it("s → confirm; y → done; e → back to browse; n → cancelled", () => {
    const s0 = initTokenPicker(CONFIG);
    const atConfirm = drive(s0, [enter, ...Array(7).fill(bs), ...type("#000000"), enter, ch("s")]);
    expect(atConfirm.phase).toBe("confirm");
    expect(reduce(atConfirm, ch("y")).phase).toBe("done");
    expect(reduce(atConfirm, ch("e")).phase).toBe("browse");
    expect(reduce(atConfirm, ch("n")).phase).toBe("cancelled");
  });

  it("terminal phases are inert", () => {
    const done = drive(initTokenPicker(CONFIG), [ch("s"), ch("y")]);
    expect(reduce(done, down)).toBe(done);
  });
});

describe("render & helpers", () => {
  it("marks the cursor row, tags new tokens, emits no ANSI by default", () => {
    const s0 = initTokenPicker(CONFIG);
    const s = drive(s0, [ch("a"), ...type("space"), enter, ...type("g"), enter, ...type("8mm"), enter]);
    const out = render(s);
    expect(out).toContain("(new)");
    expect(out).toMatch(/^▸/m);
    expect(out).toContain("Design tokens");
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("shows an advisory contrast hint for color.ink / color.page", () => {
    const out = render(initTokenPicker(CONFIG));
    expect(out).toMatch(/color\.ink on color\.page — .*:1 contrast \((AAA|AA|AA large only|too low)\)/);
  });

  it("contrastRatio: black on white is 21, identical is 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("isValidIdent matches the schema rule", () => {
    expect(isValidIdent("col-gap")).toBe(true);
    expect(isValidIdent("Color")).toBe(false);
    expect(isValidIdent("2xl")).toBe(false);
    expect(isValidIdent("")).toBe(false);
  });
});
