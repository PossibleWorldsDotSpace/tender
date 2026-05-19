import { describe, it, expect } from "vitest";
import {
  initPageSetup, reduce, render, collectEdits, invalidCustomDims,
  type PageSetupState, type KeyEvent
} from "./page-setup.js";
import type { ProjectConfig } from "@tender/core";

/** A project with two templates so list-view navigation has somewhere to
 * go, plus a `cover` so we can prove `default`'s immutability is template-
 * specific (cover is fully editable, default has guardrails). */
const CONFIG = {
  "page-templates": {
    default: {
      size: "A5",
      margin: { top: "18mm", bottom: "20mm", inner: "18mm", outer: "14mm" },
      headers: { left: "{chapter}", right: "{page}" }
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
const backspace: KeyEvent = { name: "backspace" };
const ch = (c: string): KeyEvent => ({ str: c });
const type = (s: string): KeyEvent[] => [...s].map(ch);

/** Walk into a named template's sub-screen. */
function enterTemplate(state: PageSetupState, name: string): PageSetupState {
  const i = state.templates.indexOf(name);
  expect(i).toBeGreaterThanOrEqual(0);
  // Move cursor to row i, then ↵.
  const steps: KeyEvent[] =
    i >= state.cursor
      ? Array(i - state.cursor).fill(down)
      : Array(state.cursor - i).fill(up);
  return drive(state, [...steps, enter]);
}

/* ============================ init ============================ */

describe("initPageSetup", () => {
  it("starts on the list view with one row per template", () => {
    const s = initPageSetup(CONFIG);
    expect(s.view).toBe("list");
    expect(s.templates).toEqual(["default", "cover"]);
    expect(s.fields).toHaveLength(2);
    expect(s.fields[0]).toEqual({ kind: "template-row", template: "default" });
    expect(s.fields[1]).toEqual({ kind: "template-row", template: "cover" });
  });

  it("prefills size + margin + headers drafts from the config", () => {
    const s = initPageSetup(CONFIG);
    expect(s.size.default).toMatchObject({ mode: "named", name: "A5" });
    expect(s.margin.default!.top).toMatchObject({ zero: false, value: 18, unit: "mm" });
    // cover has margin: 0 → all boxes flagged zero
    expect(s.margin.cover!.top.zero).toBe(true);
    // default has headers: parsed into boxes mode, originated
    expect(s.headers.default).toMatchObject({
      mode: "boxes", left: "{chapter}", right: "{page}", originated: true
    });
    // cover has no headers key → none mode, not originated
    expect(s.headers.cover).toMatchObject({ mode: "none", originated: false });
  });

  it("yields an empty list when there are no templates", () => {
    const s = initPageSetup({ "page-templates": {} } as unknown as ProjectConfig);
    expect(s.templates).toEqual([]);
    expect(s.fields).toHaveLength(0);
  });
});

/* ===================== list view navigation ===================== */

describe("reduce — list view", () => {
  it("↓/↑ move the cursor between templates, clamping at the ends", () => {
    const s0 = initPageSetup(CONFIG);
    expect(s0.cursor).toBe(0);
    expect(drive(s0, [down]).cursor).toBe(1);
    expect(drive(s0, [down, down, down]).cursor).toBe(1); // clamp
    expect(drive(s0, [up]).cursor).toBe(0); // clamp
  });

  it("Esc on the list cancels the whole flow", () => {
    const s = reduce(initPageSetup(CONFIG), esc);
    expect(s.phase).toBe("cancelled");
  });

  it("s on the list goes to confirm (review-all)", () => {
    const s = drive(initPageSetup(CONFIG), [ch("s")]);
    expect(s.phase).toBe("confirm");
    expect(collectEdits(s)).toEqual([]); // Enter-through ⇒ no edits
  });

  it("↵ on a template-row drills into that template", () => {
    const s = enterTemplate(initPageSetup(CONFIG), "cover");
    expect(s.view).toBe("template");
    expect(s.currentTemplate).toBe("cover");
    // template view has size + 4 margins + header-mode + 3 header-slots
    //                  + footer-mode + 3 footer-slots = 13 rows
    expect(s.fields).toHaveLength(13);
    expect(s.fields[0]).toEqual({ kind: "size", template: "cover" });
    expect(s.cursor).toBe(0);
  });

  it("Esc from the template view returns to the list (NOT cancel)", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "cover");
    s = reduce(s, esc);
    expect(s.view).toBe("list");
    expect(s.phase).toBe("edit");
    expect(s.cursor).toBe(1); // cursor lands back on the row we came from
  });
});

/* ===================== template view: size ===================== */

describe("reduce — size editing (inside a template)", () => {
  it("cycles named sizes with ←/→ and emits a page-size edit", () => {
    const s0 = enterTemplate(initPageSetup(CONFIG), "default");
    const s = drive(s0, [right]); // A5 → A6
    expect(s.size.default!.name).toBe("A6");
    expect(collectEdits(s)).toContainEqual({
      kind: "page-size", template: "default",
      value: { kind: "named", name: "A6" }
    });
  });

  it("← wraps backward from A4", () => {
    const s0 = enterTemplate(initPageSetup(CONFIG), "default");
    const s = drive(s0, [left, left]); // A5 → A4 → wrap to Legal
    expect(s.size.default!.name).toBe("Legal");
  });

  it("c toggles to custom; w edits width; Enter commits", () => {
    const s0 = enterTemplate(initPageSetup(CONFIG), "default");
    let s = drive(s0, [ch("c")]);
    expect(s.size.default!.mode).toBe("custom");
    s = drive(s, [ch("w"), ...type("200mm"), enter]);
    expect(s.size.default!.width).toBe("200mm");
    expect(s.size.default!.customEdit).toBeUndefined();
  });

  it("backspace deletes from the custom buffer", () => {
    const s0 = enterTemplate(initPageSetup(CONFIG), "default");
    let s = drive(s0, [ch("c"), ch("w"), ...type("210m"), backspace]);
    expect(s.size.default!.width).toBe("210");
  });

  it("Esc while typing a custom dim cancels that edit, not the screen", () => {
    const s0 = enterTemplate(initPageSetup(CONFIG), "default");
    let s = drive(s0, [ch("c"), ch("w"), ...type("xyz"), esc]);
    expect(s.view).toBe("template"); // still in the template
    expect(s.size.default!.customEdit).toBeUndefined();
  });

  it("flags invalid custom dimensions across templates", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "default");
    s = drive(s, [ch("c"), ch("w"), ...type("nope"), enter]);
    expect(invalidCustomDims(s)).toContain('default.size width "nope"');
  });
});

/* ===================== template view: margins ===================== */

describe("reduce — margin editing", () => {
  it("+/- steps length, u cycles unit, emits a page-margin edit", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "default");
    s = drive(s, [down]); // cursor on default.margin.top
    s = drive(s, [ch("+"), ch("+"), ch("u")]);
    expect(s.margin.default!.top.value).toBe(20);
    expect(s.margin.default!.top.unit).not.toBe("mm");
    expect(collectEdits(s).some(e => e.kind === "page-margin")).toBe(true);
  });

  it("z toggles the whole template margin to 0 and back", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "default");
    s = drive(s, [down]); // any margin row
    s = drive(s, [ch("z")]);
    expect(["top", "bottom", "inner", "outer"].every(
      k => s.margin.default![k as "top"].zero
    )).toBe(true);
    const e1 = collectEdits(s).find(e => e.kind === "page-margin");
    expect(e1).toMatchObject({ value: { kind: "zero" } });
    s = drive(s, [ch("z")]); // back to a box
    expect(s.margin.default!.top.zero).toBe(false);
  });

  it("stepping a zero'd margin is inert until z restores the box", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "cover"); // cover has margin: 0
    s = drive(s, [down]); // margin.top, which is zero
    s = drive(s, [ch("+")]);
    expect(s.margin.cover!.top.zero).toBe(true); // unchanged
    expect(s.status).toMatch(/Press z to give it edges/);
  });
});

/* ===================== template view: headers/footers ===================== */

describe("reduce — headers & footers", () => {
  it("Enter on a header-slot flips mode to boxes and starts typing", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "cover"); // headers start as none
    // size + 4 margins + header-mode = 6 down moves to header-mode,
    // then one more to header-slot left.
    s = drive(s, Array(6).fill(down));
    expect(s.fields[s.cursor]).toMatchObject({ kind: "header-slot", slot: "left" });
    s = drive(s, [enter]);
    expect(s.headers.cover!.mode).toBe("boxes");
    expect(s.headers.cover!.editing).toBe("left");
    s = drive(s, [...type("{chapter}"), enter]);
    expect(s.headers.cover!.left).toBe("{chapter}");
    expect(collectEdits(s)).toContainEqual(
      expect.objectContaining({ kind: "page-headers", template: "cover" })
    );
  });

  it("←/→ on header-mode toggles between none and boxes", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "default"); // headers in boxes
    s = drive(s, Array(5).fill(down)); // header-mode
    expect(s.fields[s.cursor].kind).toBe("header-mode");
    s = drive(s, [right]);
    expect(s.headers.default!.mode).toBe("none");
    // Now collectEdits should emit a page-headers: "none"
    expect(collectEdits(s)).toContainEqual({
      kind: "page-headers", template: "default", value: "none"
    });
  });

  it("Enter-through a template's rows is a no-op for headers/footers", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "default");
    // Walk every row and back — no edits.
    s = drive(s, Array(15).fill(down));
    s = drive(s, Array(15).fill(up));
    expect(collectEdits(s)).toEqual([]);
  });

  it("↵ on empty buffer keeps the slot's current value (replace-on-type)", () => {
    // default's header.left starts as "{chapter}".
    let s = enterTemplate(initPageSetup(CONFIG), "default");
    s = drive(s, Array(6).fill(down)); // size + 4 margins + header-mode → header.left
    expect(s.fields[s.cursor]).toMatchObject({ kind: "header-slot", slot: "left" });
    s = drive(s, [enter]); // enter edit; buffer starts empty (replace-on-type)
    expect(s.headers.default!.editing).toBe("left");
    expect(s.headers.default!.buffer).toBe("");
    s = drive(s, [enter]); // ↵ on empty = keep current
    expect(s.headers.default!.editing).toBeUndefined();
    expect(s.headers.default!.left).toBe("{chapter}");
    // No header edit emitted for default — value unchanged.
    expect(
      collectEdits(s).filter(e => e.kind === "page-headers" && e.template === "default")
    ).toEqual([]);
  });
});

/* ===================== add-template sub-flow ===================== */

describe("reduce — add a template", () => {
  it("a opens the add sub-flow; ↵ commits and drops into the new template", () => {
    let s = initPageSetup(CONFIG);
    s = drive(s, [ch("a")]);
    expect(s.add).toBeDefined();
    s = drive(s, [...type("chapter-opener"), enter]);
    expect(s.add).toBeUndefined();
    expect(s.templates).toEqual(["default", "cover", "chapter-opener"]);
    expect(s.view).toBe("template");
    expect(s.currentTemplate).toBe("chapter-opener");
    // New template carries a page-template-add edit
    expect(collectEdits(s)).toContainEqual(
      expect.objectContaining({ kind: "page-template-add", template: "chapter-opener" })
    );
  });

  it("rejects invalid idents and duplicates", () => {
    let s = drive(initPageSetup(CONFIG), [ch("a"), ...type("Bad Name"), enter]);
    expect(s.add!.error).toMatch(/lowercase/);
    s = drive(initPageSetup(CONFIG), [ch("a"), ...type("default"), enter]);
    expect(s.add!.error).toMatch(/already exists/);
  });

  it("Esc inside the add flow returns to the list without adding", () => {
    const s0 = initPageSetup(CONFIG);
    const s = drive(s0, [ch("a"), ...type("foo"), esc]);
    expect(s.add).toBeUndefined();
    expect(s.templates).toEqual(["default", "cover"]); // unchanged
    expect(s.status).toMatch(/Add cancelled/);
  });
});

/* ===================== confirm phase ===================== */

describe("reduce — confirm phase", () => {
  it("s on list → confirm; y → done; collectEdits stable", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "default");
    s = drive(s, [right]); // change size
    s = reduce(s, esc); // back to list
    s = reduce(s, ch("s"));
    expect(s.phase).toBe("confirm");
    const before = collectEdits(s);
    s = reduce(s, ch("y"));
    expect(s.phase).toBe("done");
    expect(collectEdits(s)).toEqual(before);
  });

  it("n cancels from confirm; e returns to editing", () => {
    let s = drive(initPageSetup(CONFIG), [ch("s")]);
    expect(reduce(s, ch("n")).phase).toBe("cancelled");
    expect(reduce(s, ch("e")).phase).toBe("edit");
  });

  it("done/cancelled are terminal — further keys inert", () => {
    let s = drive(initPageSetup(CONFIG), [ch("s"), ch("y")]);
    expect(reduce(s, down)).toBe(s);
  });
});

/* ============================ render ============================ */

describe("render — list view", () => {
  it("shows template rows with summaries and tags default as immutable", () => {
    const out = render(initPageSetup(CONFIG));
    expect(out).toContain("Page setup");
    expect(out).toContain("default");
    expect(out).toContain("(immutable)");
    expect(out).toContain("cover");
    expect(out).toMatch(/^▸/m);
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("shows the intro paragraph", () => {
    const out = render(initPageSetup(CONFIG));
    expect(out).toMatch(/several page templates/);
  });
});

describe("render — template view", () => {
  it("draws sections (Page / Headers / Footers) with all rows", () => {
    const s = enterTemplate(initPageSetup(CONFIG), "default");
    const out = render(s);
    expect(out).toContain("Page");
    expect(out).toContain("Headers");
    expect(out).toContain("Footers");
    expect(out).toContain("size");
    expect(out).toContain("margin.top");
    expect(out).toContain("header.left");
    expect(out).toContain("footer.center");
  });
});

describe("render — confirm + add", () => {
  it("confirm with a diff renders prompt + diff lines", () => {
    const s = drive(initPageSetup(CONFIG), [ch("s")]); // straight to confirm
    const out = render(s, undefined, "- size: A5\n+ size: A4");
    expect(out).toContain("Apply these changes?");
    expect(out).toContain("- size: A5");
    expect(out).toContain("+ size: A4");
  });

  it("confirm with no diff says nothing changed", () => {
    const s = drive(initPageSetup(CONFIG), [ch("s")]);
    expect(render(s)).toMatch(/Nothing changed/);
  });

  it("add-template renders name field with the typing buffer", () => {
    const s = drive(initPageSetup(CONFIG), [ch("a"), ...type("ch")]);
    const out = render(s);
    expect(out).toContain("Add a page template");
    expect(out).toContain("ch"); // buffer
    expect(out).toMatch(/short identifier/); // hint
  });
});

/* ============================ idempotence ============================ */

describe("idempotence property", () => {
  it("a walk through every row that changes nothing produces no edits", () => {
    let s = enterTemplate(initPageSetup(CONFIG), "default");
    s = drive(s, Array(15).fill(down));
    s = drive(s, Array(15).fill(up));
    s = reduce(s, esc); // back to list
    expect(collectEdits(s)).toEqual([]);
  });
});
