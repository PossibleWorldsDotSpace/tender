/**
 * Design-token picker as a PURE state machine — same architecture as
 * page-setup.ts (reduce/render are total, no process I/O) so the whole
 * interaction is unit-testable without a pseudo-TTY. Absorbs the #8 widget
 * scope: per-token editing with category-aware behaviour (color hex
 * normalize + contrast hint; everything else free string/number) and the
 * ability to ADD new tokens, not just edit existing ones.
 *
 * Copy here is provisional (see #17 slice 5).
 */

import type { ProjectConfig } from "@tender/core";
import { normalizeHex } from "./values.js";
import type { Edit } from "./document.js";

/** Minimal key event the driver maps node keypress onto (shared shape). */
export interface KeyEvent {
  str?: string;
  name?: string;
}

const IDENT_RE = /^[a-z][a-z0-9-]*$/;
export function isValidIdent(s: string): boolean {
  return IDENT_RE.test(s);
}

/**
 * Relative luminance + WCAG contrast ratio for two hex colors. Used only as
 * an advisory hint on the conventional `color` category (e.g. ink vs page).
 * Not a gate — authors can set whatever they want.
 */
function luminance(hex: string): number {
  const h = hex.slice(1);
  const ch = (i: number): number => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

interface TokenRow {
  category: string;
  name: string;
  /** Original value as a string for display/diff; numbers kept as text. */
  initial: string;
  /** Working value (string form). */
  value: string;
  /** True when this row was added during this session (vs. pre-existing). */
  added: boolean;
}

type Phase = "browse" | "edit" | "add" | "confirm" | "done" | "cancelled";

/** State for the "add a token" sub-flow. */
interface AddDraft {
  step: "category" | "name" | "value";
  category: string;
  name: string;
  value: string;
  error: string;
}

export interface TokenPickerState {
  rows: TokenRow[];
  cursor: number;
  phase: Phase;
  /** Buffer for in-place edit of the row at `cursor`. */
  buffer: string;
  add: AddDraft;
  status: string;
}

export function initTokenPicker(config: ProjectConfig): TokenPickerState {
  const tokens = (config["design-tokens"] ?? {}) as Record<
    string,
    Record<string, string | number>
  >;
  const rows: TokenRow[] = [];
  for (const [category, group] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(group)) {
      const v = String(value);
      rows.push({ category, name, initial: v, value: v, added: false });
    }
  }
  return {
    rows,
    cursor: 0,
    phase: "browse",
    buffer: "",
    add: { step: "category", category: "", name: "", value: "", error: "" },
    status: ""
  };
}

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** Coerce a string value back to number when it round-trips cleanly. */
function coerce(value: string): string | number {
  if (value.trim() === "") return value;
  const n = Number(value);
  return Number.isFinite(n) && String(n) === value.trim() ? n : value;
}

export function reduce(
  state: TokenPickerState,
  key: KeyEvent
): TokenPickerState {
  if (state.phase === "done" || state.phase === "cancelled") return state;

  if (state.phase === "confirm") {
    if (key.str === "y" || key.str === "Y") return { ...state, phase: "done" };
    if (key.str === "n" || key.str === "N") return { ...state, phase: "cancelled" };
    if (key.str === "e" || key.name === "escape") {
      return { ...state, phase: "browse", status: "" };
    }
    return state;
  }

  if (state.phase === "add") return reduceAdd(state, key);

  if (state.phase === "edit") {
    const row = state.rows[state.cursor];
    if (!row) return { ...state, phase: "browse" };
    if (key.name === "return") {
      const next = clone(state.rows);
      let v = state.buffer;
      if (row.category === "color") {
        const norm = normalizeHex(v);
        if (norm) v = norm; // tolerate non-hex (could be a var()/keyword)
      }
      next[state.cursor]!.value = v;
      return { ...state, rows: next, phase: "browse", buffer: "", status: "" };
    }
    if (key.name === "escape") {
      return { ...state, phase: "browse", buffer: "", status: "edit cancelled" };
    }
    if (key.name === "backspace") {
      return { ...state, buffer: state.buffer.slice(0, -1) };
    }
    if (key.str && key.str.length === 1 && key.str >= " ") {
      return { ...state, buffer: state.buffer + key.str };
    }
    return state;
  }

  // browse
  if (key.name === "escape") return { ...state, phase: "cancelled" };
  if (key.name === "up") {
    return { ...state, cursor: Math.max(0, state.cursor - 1), status: "" };
  }
  if (key.name === "down") {
    return {
      ...state,
      cursor: Math.min(Math.max(0, state.rows.length - 1), state.cursor + 1),
      status: ""
    };
  }
  if (key.name === "return") {
    if (state.rows.length === 0) return state;
    return { ...state, phase: "edit", buffer: state.rows[state.cursor]!.value };
  }
  if (key.str === "a") {
    return {
      ...state,
      phase: "add",
      add: { step: "category", category: "", name: "", value: "", error: "" }
    };
  }
  if (key.str === "s") {
    return { ...state, phase: "confirm", status: "" };
  }
  return state;
}

function reduceAdd(
  state: TokenPickerState,
  key: KeyEvent
): TokenPickerState {
  const add = clone(state.add);

  if (key.name === "escape") {
    return { ...state, phase: "browse", status: "add cancelled" };
  }
  if (key.name === "backspace") {
    if (add.step === "category") add.category = add.category.slice(0, -1);
    else if (add.step === "name") add.name = add.name.slice(0, -1);
    else add.value = add.value.slice(0, -1);
    add.error = "";
    return { ...state, add };
  }
  if (key.name === "return") {
    if (add.step === "category") {
      if (!isValidIdent(add.category)) {
        add.error = "category must match /^[a-z][a-z0-9-]*$/";
        return { ...state, add };
      }
      add.step = "name";
      add.error = "";
      return { ...state, add };
    }
    if (add.step === "name") {
      if (!isValidIdent(add.name)) {
        add.error = "name must match /^[a-z][a-z0-9-]*$/";
        return { ...state, add };
      }
      if (
        state.rows.some(
          r => r.category === add.category && r.name === add.name
        )
      ) {
        add.error = `${add.category}.${add.name} already exists`;
        return { ...state, add };
      }
      add.step = "value";
      add.error = "";
      return { ...state, add };
    }
    // value step → commit the new row
    let v = add.value;
    if (add.category === "color") {
      const norm = normalizeHex(v);
      if (norm) v = norm;
    }
    const rows = clone(state.rows);
    rows.push({
      category: add.category,
      name: add.name,
      initial: "", // absent before → any value is a change
      value: v,
      added: true
    });
    return {
      ...state,
      rows,
      cursor: rows.length - 1,
      phase: "browse",
      add: { step: "category", category: "", name: "", value: "", error: "" },
      status: `added ${add.category}.${add.name}`
    };
  }
  if (key.str && key.str.length === 1 && key.str >= " ") {
    if (add.step === "category") add.category += key.str;
    else if (add.step === "name") add.name += key.str;
    else add.value += key.str;
    add.error = "";
    return { ...state, add };
  }
  return state;
}

/**
 * Token Edits for changed/added rows only. A row whose value equals its
 * initial (and wasn't added) yields nothing — Enter-through / change-and-
 * revert are true no-ops, upholding the slice-1 idempotence contract.
 */
export function collectEdits(state: TokenPickerState): Edit[] {
  const edits: Edit[] = [];
  for (const r of state.rows) {
    if (!r.added && r.value === r.initial) continue;
    edits.push({
      kind: "token",
      category: r.category,
      name: r.name,
      value: coerce(r.value)
    });
  }
  return edits;
}

/** Pure renderer — no ANSI (driver adds emphasis), test-readable. */
export function render(state: TokenPickerState): string {
  const L: string[] = [];

  if (state.phase === "confirm") {
    L.push("Review token changes");
    L.push("");
    L.push("(diff shown by the driver)");
    L.push("");
    L.push("Apply? [y]es  [n]o  [e]dit more");
    return L.join("\n");
  }

  if (state.phase === "add") {
    const a = state.add;
    L.push("Add a token");
    L.push("");
    const mark = (s: string): string => (a.step === s ? ">" : " ");
    L.push(`${mark("category")} category: ${a.category}${a.step === "category" ? "_" : ""}`);
    L.push(`${mark("name")} name:     ${a.name}${a.step === "name" ? "_" : ""}`);
    L.push(`${mark("value")} value:    ${a.value}${a.step === "value" ? "_" : ""}`);
    if (a.error) {
      L.push("");
      L.push(a.error);
    }
    L.push("");
    L.push("Enter: next/commit · Esc: cancel");
    return L.join("\n");
  }

  L.push("Design tokens — ↑/↓ move · Enter edit · a add · s review · Esc cancel");
  L.push("");

  if (state.rows.length === 0) {
    L.push("(no tokens yet — press a to add one)");
  } else {
    const w = Math.max(
      ...state.rows.map(r => `${r.category}.${r.name}`.length)
    );
    for (let i = 0; i < state.rows.length; i++) {
      const r = state.rows[i]!;
      const cur = i === state.cursor ? ">" : " ";
      const path = `${r.category}.${r.name}`.padEnd(w);
      const editing = state.phase === "edit" && i === state.cursor;
      const val = editing ? `${state.buffer}_` : r.value;
      const tag = r.added ? " (new)" : "";
      L.push(`${cur} ${path}  ${val}${tag}`);
    }

    // Advisory contrast hint when the conventional color.ink / color.page
    // pair both look like hex — not a gate, just guidance.
    const hex = (n: string): string | null => {
      const row = state.rows.find(
        r => r.category === "color" && r.name === n
      );
      return row ? normalizeHex(row.value) : null;
    };
    const ink = hex("ink");
    const page = hex("page");
    if (ink && page) {
      const ratio = contrastRatio(ink, page);
      const note =
        ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA-large" : "low";
      L.push("");
      L.push(`color.ink / color.page contrast: ${ratio}:1 (${note})`);
    }
  }

  if (state.status) {
    L.push("");
    L.push(state.status);
  }
  return L.join("\n");
}
