import { describe, it, expect } from "vitest";
import {
  initPageSetup, reduce, render, collectEdits, invalidCustomDims,
  type PageSetupState, type KeyEvent
} from "./page-setup.js";
import type { ProjectConfig } from "@tender/core";

const CONFIG = {
  "page-templates": {
    default: {
      size: "A5",
      margin: { top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm" }
    },
    cover: { size: "A5", margin: 0 }
  }
} as unknown as ProjectConfig;

/** Feed a sequence of key events through the reducer. */
function drive(state: PageSetupState, keys: KeyEvent[]): PageSetupState {
  return keys.reduce((s, k) => reduce(s, k), state);
}
const down: KeyEvent = { name: "down" };
const up: KeyEvent = { name: "up" };
const right: KeyEvent = { name: "right" };
const left: KeyEvent = { name: "left" };
const enter: KeyEvent = { name: "return" };
const esc: KeyEvent = { name: "escape" };
const ch = (c: string): KeyEvent => ({ str: c });

describe("initPageSetup", () => {
  it("builds one size + four margin fields per template", () => {
    const s = initPageSetup(CONFIG);
    expect(s.templates).toEqual(["default", "cover"]);
    // 2 templates × (1 size + 4 margins) = 10 fields
    expect(s.fields).toHaveLength(10);
    expect(s.fields[0]).toEqual({ kind: "size", template: "default" });
    expect(s.fields[1]).toMatchObject({ kind: "margin", template: "default", box: "top" });
  });

  it("prefills size + margin drafts from the config", () => {
    const s = initPageSetup(CONFIG);
    expect(s.size.default).toMatchObject({ mode: "named", name: "A5" });
    expect(s.margin.default!.top).toMatchObject({ zero: false, value: 18, unit: "mm" });
    // cover has margin: 0 → all boxes flagged zero
    expect(s.margin.cover!.top.zero).toBe(true);
  });

  it("yields an empty screen when there are no templates", () => {
    const s = initPageSetup({ "page-templates": {} } as unknown as ProjectConfig);
    expect(s.fields).toHaveLength(0);
  });
});

describe("reduce — navigation & no-op", () => {
  it("Enter-through (no edits) collects zero edits", () => {
    const s0 = initPageSetup(CONFIG);
    const s = drive(s0, [down, down, up, enter]); // wander, then confirm
    expect(s.phase).toBe("confirm");
    expect(collectEdits(s)).toEqual([]);
  });

  it("clamps the cursor at both ends", () => {
    const s0 = initPageSetup(CONFIG);
    expect(drive(s0, [up, up, up]).cursor).toBe(0);
    const end = drive(s0, Array(50).fill(down));
    expect(end.cursor).toBe(s0.fields.length - 1);
  });

  it("Esc cancels from edit phase", () => {
    const s = reduce(initPageSetup(CONFIG), esc);
    expect(s.phase).toBe("cancelled");
  });
});

describe("reduce — size editing", () => {
  it("cycles named sizes with ←/→ and emits a page-size edit", () => {
    const s0 = initPageSetup(CONFIG); // cursor on default.size
    const s = drive(s0, [right]); // A5 → A6
    expect(s.size.default!.name).toBe("A6");
    const edits = collectEdits(s);
    expect(edits).toContainEqual({
      kind: "page-size", template: "default",
      value: { kind: "named", name: "A6" }
    });
  });

  it("← wraps backward from A4", () => {
    const s0 = initPageSetup(CONFIG);
    // A5 →(left)→ A4 →(left)→ wrap to Legal
    const s = drive(s0, [left, left]);
    expect(s.size.default!.name).toBe("Legal");
  });

  it("c toggles to custom; w edits width text; Enter commits", () => {
    const s0 = initPageSetup(CONFIG);
    let s = drive(s0, [ch("c")]);
    expect(s.size.default!.mode).toBe("custom");
    s = drive(s, [ch("w"), ch("2"), ch("0"), ch("0"), ch("m"), ch("m"), enter]);
    expect(s.size.default!.width).toBe("200mm");
    expect(s.size.default!.customEdit).toBeUndefined();
    const edits = collectEdits(s);
    expect(edits[0]).toMatchObject({
      kind: "page-size", template: "default",
      value: { kind: "custom", width: "200mm" }
    });
  });

  it("backspace deletes from the custom buffer", () => {
    const s0 = initPageSetup(CONFIG);
    let s = drive(s0, [ch("c"), ch("w")]); // fresh empty buffer
    s = drive(s, [ch("9"), ch("9"), { name: "backspace" }]);
    expect(s.size.default!.width).toBe("9");
  });

  it("Esc while editing a dimension cancels just the edit, not the screen", () => {
    const s0 = initPageSetup(CONFIG);
    let s = drive(s0, [ch("c"), ch("w"), ch("5")]);
    expect(s.size.default!.width).toBe("5");
    s = reduce(s, esc);
    expect(s.phase).toBe("edit"); // screen NOT cancelled
    expect(s.size.default!.customEdit).toBeUndefined();
    // Esc again (not editing) cancels the screen.
    expect(reduce(s, esc).phase).toBe("cancelled");
  });

  it("pressing w then Enter immediately keeps the prior width (empty = keep)", () => {
    const s0 = initPageSetup(CONFIG);
    // default starts named A5; switch to custom (prefills 210×297), edit w, commit empty
    let s = drive(s0, [ch("c")]);
    const priorW = s.size.default!.width;
    s = drive(s, [ch("w"), enter]);
    expect(s.size.default!.width).toBe(priorW);
  });

  it("flags invalid custom dimensions", () => {
    const s0 = initPageSetup(CONFIG);
    let s = drive(s0, [ch("c"), ch("w")]);
    // replace buffer with junk
    s = { ...s, size: { ...s.size, default: { ...s.size.default!, width: "nope", height: "297mm" } } };
    expect(invalidCustomDims(s)).toEqual(['default.size width "nope"']);
  });
});

describe("reduce — margin editing", () => {
  it("+/- steps the length, u cycles the unit, emitting a margin edit", () => {
    const s0 = initPageSetup(CONFIG);
    // move to default.margin.top (field index 1)
    let s = drive(s0, [down]);
    expect(s.fields[s.cursor]).toMatchObject({ kind: "margin", box: "top" });
    s = drive(s, [ch("+"), ch("+"), ch("u")]); // 18→20mm, mm→cm
    expect(s.margin.default!.top).toMatchObject({ value: 20, unit: "cm" });
    const edits = collectEdits(s);
    const m = edits.find(e => e.kind === "page-margin");
    expect(m).toMatchObject({ kind: "page-margin", template: "default" });
  });

  it("z toggles the whole template margin to 0 and back", () => {
    const s0 = initPageSetup(CONFIG);
    let s = drive(s0, [down, ch("z")]); // default.margin.top → zero (all boxes)
    expect(["top", "bottom", "inner", "outer"].every(
      k => s.margin.default![k as "top"].zero
    )).toBe(true);
    const e1 = collectEdits(s).find(e => e.kind === "page-margin");
    expect(e1).toMatchObject({ value: { kind: "zero" } });
    s = drive(s, [ch("z")]); // back to a box
    expect(s.margin.default!.top.zero).toBe(false);
  });

  it("stepping a zero'd margin is inert until z restores the box", () => {
    const s0 = initPageSetup(CONFIG);
    // cover.size is field 5; cover.margin.top is field 6, and is zero
    let s = drive(s0, Array(6).fill(down));
    expect(s.fields[s.cursor]).toMatchObject({ template: "cover", box: "top" });
    s = drive(s, [ch("+")]);
    expect(s.margin.cover!.top.zero).toBe(true); // unchanged
    expect(s.status).toMatch(/z to switch/);
  });
});

describe("reduce — confirm phase", () => {
  it("Enter → confirm; y → done; collectEdits stable", () => {
    const s0 = initPageSetup(CONFIG);
    let s = drive(s0, [right, enter]); // change size, go to confirm
    expect(s.phase).toBe("confirm");
    const before = collectEdits(s);
    s = reduce(s, ch("y"));
    expect(s.phase).toBe("done");
    expect(collectEdits(s)).toEqual(before); // confirm doesn't mutate edits
  });

  it("n cancels from confirm; e returns to editing", () => {
    const s0 = initPageSetup(CONFIG);
    const atConfirm = drive(s0, [right, enter]);
    expect(reduce(atConfirm, ch("n")).phase).toBe("cancelled");
    expect(reduce(atConfirm, ch("e")).phase).toBe("edit");
  });

  it("done/cancelled are terminal — further keys are inert", () => {
    const s0 = initPageSetup(CONFIG);
    const done = drive(s0, [right, enter, ch("y")]);
    expect(reduce(done, down)).toBe(done);
  });
});

describe("render", () => {
  it("marks the cursor row and shows current values, no ANSI", () => {
    const s = initPageSetup(CONFIG);
    const out = render(s);
    expect(out).toContain("> default.size");
    expect(out).toContain("A5");
    expect(out).toContain("default.margin.top");
    // pure renderer emits no escape codes
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("confirm phase renders the apply prompt", () => {
    const s = drive(initPageSetup(CONFIG), [right, enter]);
    expect(render(s)).toMatch(/Apply\? \[y\]es/);
  });
});

describe("idempotence property (slice-1 contract upheld at the screen level)", () => {
  it("a walk that changes nothing produces an empty Edit[]", () => {
    const s0 = initPageSetup(CONFIG);
    // navigate every field, change nothing, confirm
    const walk = [...Array(s0.fields.length).fill(down), enter];
    const s = drive(s0, walk);
    expect(collectEdits(s)).toEqual([]);
  });

  it("changing a value then changing it back yields no edit", () => {
    const s0 = initPageSetup(CONFIG);
    // A5 → A6 → A5 again
    const s = drive(s0, [right, left]);
    expect(collectEdits(s)).toEqual([]);
  });
});
