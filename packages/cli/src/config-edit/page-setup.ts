/**
 * Page-setup screen as a PURE state machine. No process.stdin/stdout, no
 * readline — `reduce(state, key)` and `render(state)` are total functions
 * the driver (page-setup-driver.ts) wires to real I/O. This split is
 * deliberate: the existing `tokens edit` binds straight to the process and
 * is untestable; here the whole interaction is exercised by feeding key
 * events to the reducer and asserting state + the emitted Edit[].
 *
 * Scope (slice 2 of #17): per page-template, edit `size` (cycle named
 * A4/A5/… or switch to a custom width×height) and `margin` (the literal 0,
 * or top/bottom/inner/outer length steppers with unit cycling). Headers/
 * footers and add/remove-template are later work — the state shape leaves
 * room but the field set is intentionally just size+margin here.
 */

import type { ProjectConfig } from "@tender/core";
import {
  cycleUnit, formatLength, parseLength,
  NAMED_PAGE_SIZES, type NamedPageSize, type LengthUnit,
  parsePageSize, parseMargin,
  type PageSizeValue, type MarginValue
} from "./values.js";
import type { Edit } from "./document.js";

/** A simplified key event — the subset of readline.Key the reducer cares
 * about. The driver maps node's keypress events onto this. */
export interface KeyEvent {
  /** Printable char, if any (e.g. "a", "5", "-"). */
  str?: string;
  /** Named key: up/down/left/right/return/escape/backspace/tab/space. */
  name?: string;
}

const MARGIN_KEYS = ["top", "bottom", "inner", "outer"] as const;
type MarginKey = (typeof MARGIN_KEYS)[number];

/** One editable row. Size rows cycle/toggle; margin rows step a length. */
export type Field =
  | { kind: "size"; template: string }
  | { kind: "margin"; template: string; box: MarginKey };

/** Working value for a template's size while the screen is open. */
interface SizeDraft {
  /** "named" cycles NAMED_PAGE_SIZES; "custom" edits width/height text. */
  mode: "named" | "custom";
  name: NamedPageSize;
  width: string;
  height: string;
  /** When custom: which sub-field is being text-edited, if any. */
  customEdit?: "width" | "height";
  buffer: string;
}

/** Working value for one margin box. `zero` means the whole margin is `0`. */
interface MarginDraft {
  /** Per-template: is the margin the literal 0, or a box? */
  zero: boolean;
  value: number;
  unit: LengthUnit;
}

export interface PageSetupState {
  templates: string[];
  fields: Field[];
  cursor: number;
  /** Per-template size + per (template,box) margin drafts. */
  size: Record<string, SizeDraft>;
  margin: Record<string, Record<MarginKey, MarginDraft>>;
  /** Snapshot of the initial drafts, to compute the no-op / Edit[] set. */
  initial: {
    size: Record<string, SizeDraft>;
    margin: Record<string, Record<MarginKey, MarginDraft>>;
  };
  /** Lifecycle: editing → confirm (diff shown) → done/cancelled. */
  phase: "edit" | "confirm" | "done" | "cancelled";
  status: string;
}

function defaultMarginDraft(): MarginDraft {
  return { zero: false, value: 0, unit: "mm" };
}

function sizeDraftFrom(v: PageSizeValue): SizeDraft {
  if (v.kind === "named") {
    return { mode: "named", name: v.name, width: "210mm", height: "297mm", buffer: "" };
  }
  return { mode: "custom", name: "A4", width: v.width, height: v.height, buffer: "" };
}

function marginDraftsFrom(v: MarginValue | null): Record<MarginKey, MarginDraft> {
  const out = {} as Record<MarginKey, MarginDraft>;
  for (const k of MARGIN_KEYS) out[k] = defaultMarginDraft();
  if (!v || v.kind === "zero") {
    for (const k of MARGIN_KEYS) out[k].zero = true;
    return out;
  }
  for (const k of MARGIN_KEYS) {
    const raw = v[k];
    const len = raw ? parseLength(raw) : null;
    if (len) { out[k].value = len.value; out[k].unit = len.unit; }
  }
  return out;
}

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/**
 * Build initial screen state from the project config. Templates with no
 * `page-templates` entry yield an empty screen (caller should not open it).
 */
export function initPageSetup(config: ProjectConfig): PageSetupState {
  const pts = config["page-templates"] ?? {};
  const templates = Object.keys(pts);
  const size: PageSetupState["size"] = {};
  const margin: PageSetupState["margin"] = {};
  const fields: Field[] = [];

  for (const t of templates) {
    const tpl = pts[t] as { size?: unknown; margin?: unknown } | undefined;
    size[t] = sizeDraftFrom(
      parsePageSize((tpl?.size as string | [string, string]) ?? "A4")
    );
    margin[t] = marginDraftsFrom(parseMargin(tpl?.margin ?? 0));
    fields.push({ kind: "size", template: t });
    for (const box of MARGIN_KEYS) fields.push({ kind: "margin", template: t, box });
  }

  return {
    templates,
    fields,
    cursor: 0,
    size,
    margin,
    initial: { size: clone(size), margin: clone(margin) },
    phase: "edit",
    status: ""
  };
}

const NAMED = NAMED_PAGE_SIZES as readonly NamedPageSize[];

function cycleNamed(name: NamedPageSize, dir: 1 | -1): NamedPageSize {
  const i = NAMED.indexOf(name);
  return NAMED[(i + dir + NAMED.length) % NAMED.length]!;
}

/**
 * Total reducer. Never mutates `state`; returns the next state. The driver
 * calls this for every keypress and re-renders the result.
 */
export function reduce(state: PageSetupState, key: KeyEvent): PageSetupState {
  if (state.phase === "done" || state.phase === "cancelled") return state;

  // Confirm phase: y applies, n/esc cancels, e returns to editing.
  if (state.phase === "confirm") {
    if (key.str === "y" || key.str === "Y") return { ...state, phase: "done" };
    if (key.str === "n" || key.str === "N") return { ...state, phase: "cancelled" };
    if (key.str === "e" || key.name === "escape") {
      return { ...state, phase: "edit", status: "" };
    }
    return state;
  }

  const field = state.fields[state.cursor];
  if (!field) return state;

  // Esc while text-editing a custom dimension cancels just that edit (keeps
  // the prior value); Esc elsewhere cancels the whole screen.
  if (key.name === "escape") {
    if (field.kind === "size" && state.size[field.template]!.customEdit) {
      const s = clone(state.size[field.template]!);
      s.customEdit = undefined;
      s.buffer = "";
      return setSize(state, field.template, s, "edit cancelled");
    }
    return { ...state, phase: "cancelled" };
  }

  if (field.kind === "size") {
    const s = clone(state.size[field.template]!);
    if (s.customEdit) {
      // Text-editing a custom dimension.
      if (key.name === "return") {
        s.customEdit = undefined; s.buffer = "";
        return setSize(state, field.template, s, "");
      }
      if (key.name === "backspace") {
        s.buffer = s.buffer.slice(0, -1);
        if (s.customEdit === "width") s.width = s.buffer;
        else s.height = s.buffer;
        return setSize(state, field.template, s, "");
      }
      if (key.str && key.str.length === 1 && key.str >= " ") {
        s.buffer += key.str;
        if (s.customEdit === "width") s.width = s.buffer;
        else s.height = s.buffer;
        return setSize(state, field.template, s, "");
      }
      return state;
    }
    // Not text-editing: navigation + size manipulation.
    if (key.name === "up") return move(state, -1);
    if (key.name === "down") return move(state, 1);
    if (key.name === "return") return toConfirm(state);
    if (key.str === "c") {
      s.mode = s.mode === "named" ? "custom" : "named";
      return setSize(state, field.template, s,
        s.mode === "custom" ? "custom size — ←/→ field, Enter to edit" : "");
    }
    if (s.mode === "named" && (key.name === "left" || key.name === "right")) {
      s.name = cycleNamed(s.name, key.name === "right" ? 1 : -1);
      return setSize(state, field.template, s, "");
    }
    if (s.mode === "custom" && key.name === "return") {
      // (unreachable: return handled above) kept for clarity
    }
    if (s.mode === "custom" && (key.str === "w" || key.str === "h")) {
      // Start from an empty buffer (type the new value fresh; Enter with an
      // empty buffer keeps the prior dimension — see the "return" branch).
      s.customEdit = key.str === "w" ? "width" : "height";
      s.buffer = "";
      return setSize(state, field.template, s,
        `type ${s.customEdit} value, Enter to commit (empty = keep)`);
    }
    return state;
  }

  // Margin field.
  const md = clone(state.margin[field.template]![field.box]);
  if (key.name === "up") return move(state, -1);
  if (key.name === "down") return move(state, 1);
  if (key.name === "return") return toConfirm(state);
  if (key.str === "z") {
    // Toggle the whole template margin between 0 and box.
    const next = clone(state.margin[field.template]!);
    const nowZero = !next[field.box].zero;
    for (const k of MARGIN_KEYS) next[k].zero = nowZero;
    return {
      ...state,
      margin: { ...state.margin, [field.template]: next },
      status: nowZero ? "margin set to 0" : "margin is a box"
    };
  }
  if (md.zero) return { ...state, status: "press z to switch from 0 to a box" };
  if (key.str === "+" || key.str === "=" || key.name === "right") {
    md.value = Math.round((md.value + 1) * 1000) / 1000;
    return setMargin(state, field.template, field.box, md);
  }
  if (key.str === "-" || key.name === "left") {
    md.value = Math.round((md.value - 1) * 1000) / 1000;
    return setMargin(state, field.template, field.box, md);
  }
  if (key.str === "u") {
    md.unit = cycleUnit(md.unit, 1);
    return setMargin(state, field.template, field.box, md);
  }
  return state;
}

function move(state: PageSetupState, dir: -1 | 1): PageSetupState {
  const cursor = Math.min(
    state.fields.length - 1,
    Math.max(0, state.cursor + dir)
  );
  return { ...state, cursor, status: "" };
}

function setSize(
  state: PageSetupState, template: string, s: SizeDraft, status: string
): PageSetupState {
  return { ...state, size: { ...state.size, [template]: s }, status };
}

function setMargin(
  state: PageSetupState, template: string, box: MarginKey, md: MarginDraft
): PageSetupState {
  const next = { ...state.margin[template]!, [box]: md };
  return { ...state, margin: { ...state.margin, [template]: next }, status: "" };
}

function toConfirm(state: PageSetupState): PageSetupState {
  return { ...state, phase: "confirm", status: "" };
}

/**
 * The Edit[] this screen produces — only fields whose draft differs from
 * the initial snapshot. Empty array ⇒ a true no-op walk (Enter-through),
 * which the driver turns into "nothing to write".
 */
export function collectEdits(state: PageSetupState): Edit[] {
  const edits: Edit[] = [];
  for (const t of state.templates) {
    const s = state.size[t]!;
    const s0 = state.initial.size[t]!;
    if (!sameSize(s, s0)) {
      edits.push({ kind: "page-size", template: t, value: draftToPageSize(s) });
    }
    const m = state.margin[t]!;
    const m0 = state.initial.margin[t]!;
    if (!sameMargin(m, m0)) {
      edits.push({ kind: "page-margin", template: t, value: draftToMargin(m) });
    }
  }
  return edits;
}

function draftToPageSize(s: SizeDraft): PageSizeValue {
  return s.mode === "named"
    ? { kind: "named", name: s.name }
    : { kind: "custom", width: s.width, height: s.height };
}

function draftToMargin(m: Record<MarginKey, MarginDraft>): MarginValue {
  if (MARGIN_KEYS.every(k => m[k].zero)) return { kind: "zero" };
  const out: MarginValue = { kind: "box" };
  for (const k of MARGIN_KEYS) {
    out[k] = formatLength({ value: m[k].value, unit: m[k].unit });
  }
  return out;
}

function sameSize(a: SizeDraft, b: SizeDraft): boolean {
  if (a.mode !== b.mode) return false;
  return a.mode === "named"
    ? a.name === b.name
    : a.width === b.width && a.height === b.height;
}

function sameMargin(
  a: Record<MarginKey, MarginDraft>, b: Record<MarginKey, MarginDraft>
): boolean {
  return MARGIN_KEYS.every(k =>
    a[k].zero === b[k].zero &&
    (a[k].zero || (a[k].value === b[k].value && a[k].unit === b[k].unit))
  );
}

/** Validate text-entered custom dimensions; surfaced by the driver. */
export function invalidCustomDims(state: PageSetupState): string[] {
  const bad: string[] = [];
  for (const t of state.templates) {
    const s = state.size[t]!;
    if (s.mode !== "custom") continue;
    if (!parseLength(s.width)) bad.push(`${t}.size width "${s.width}"`);
    if (!parseLength(s.height)) bad.push(`${t}.size height "${s.height}"`);
  }
  return bad;
}

/**
 * Pure renderer. Returns the full screen as a string (no ANSI here — the
 * driver wraps cursor lines via ui/style so this stays test-readable and
 * NO_COLOR-correct). The driver clears the screen and prints this.
 */
export function render(state: PageSetupState): string {
  const L: string[] = [];

  if (state.phase === "confirm") {
    L.push("Review page setup changes");
    L.push("");
    L.push("(diff shown by the driver)");
    L.push("");
    L.push("Apply? [y]es  [n]o  [e]dit more");
    return L.join("\n");
  }

  L.push("Page setup — ↑/↓ move · Enter: review & apply · Esc: cancel");
  L.push("");

  for (let i = 0; i < state.fields.length; i++) {
    const f = state.fields[i]!;
    const cur = i === state.cursor ? ">" : " ";
    if (f.kind === "size") {
      const s = state.size[f.template]!;
      const val =
        s.mode === "named"
          ? `${s.name}   (←/→ change · c: custom)`
          : `${s.width} × ${s.height}   (w/h: edit · c: named)` +
            (s.customEdit ? `  [editing ${s.customEdit}: ${s.buffer}_]` : "");
      L.push(`${cur} ${f.template}.size      ${val}`);
    } else {
      const m = state.margin[f.template]![f.box];
      const val = m.zero
        ? "0   (z: switch to a box)"
        : `${m.value}${m.unit}   (+/- step · u: unit · z: zero)`;
      L.push(`${cur} ${f.template}.margin.${f.box.padEnd(6)} ${val}`);
    }
  }

  if (state.status) {
    L.push("");
    L.push(state.status);
  }
  return L.join("\n");
}
