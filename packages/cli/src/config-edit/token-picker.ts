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
import { glyph, copy, plainTheme, renderLegend, type Theme } from "./theme.js";

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

/**
 * State for the "add a token" sub-flow.
 *
 * Category step is two-mode:
 *  - `"pick"`: ←/→ cycles the conventional categories + "other"; ↵ on a
 *    conventional one commits & advances; ↵ on "other" flips to free-text.
 *  - `"freetext"`: type your own category name; ↵ commits & advances.
 *
 * `category` is the buffer in either mode (in pick mode it tracks the
 * highlighted CATEGORY_PICKS entry so the commit/advance step is uniform).
 */
interface AddDraft {
  step: "category" | "name" | "value";
  categoryMode: "pick" | "freetext";
  /** Index into CATEGORY_PICKS while categoryMode === "pick". Ignored
   * otherwise. Kept on the draft so cursor position survives re-renders. */
  categoryPick: number;
  category: string;
  name: string;
  value: string;
  error: string;
}

/** The conventional categories surfaced as a pick-list. "other" is a
 * pseudo-entry that drops to free-text; selecting it doesn't commit. */
export const CATEGORY_PICKS = ["color", "size", "font", "space", "other"] as const;
type CategoryPick = (typeof CATEGORY_PICKS)[number];

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
    add: {
      step: "category",
      categoryMode: "pick",
      categoryPick: 0,
      category: CATEGORY_PICKS[0],
      name: "",
      value: "",
      error: ""
    },
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

  // Confirm phase: w writes & continues, d discards, e/esc returns to browse.
  // Same keys as page-setup (see theme.ts copy.review.actions rationale).
  if (state.phase === "confirm") {
    if (key.str === "w" || key.str === "W") return { ...state, phase: "done" };
    if (key.str === "d" || key.str === "D") return { ...state, phase: "cancelled" };
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
      // Empty buffer = "keep current" — return to browse without touching the
      // row. Matches the "replace-on-type" UX where the current value is
      // shown beside an empty editor and ↵ on empty preserves it.
      if (state.buffer.length === 0) {
        return { ...state, phase: "browse", buffer: "", status: "" };
      }
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
      return { ...state, phase: "browse", buffer: "", status: copy.tokens.editCancelled };
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
    // Empty buffer on enter-to-edit; current value renders beside the editor
    // as a dimmed "current: …" hint. Typing replaces, ↵ on empty keeps.
    return { ...state, phase: "edit", buffer: "" };
  }
  if (key.str === "a") {
    return {
      ...state,
      phase: "add",
      add: {
        step: "category",
        categoryMode: "pick",
        categoryPick: 0,
        category: CATEGORY_PICKS[0],
        name: "",
        value: "",
        error: ""
      }
    };
  }
  // `n` = "next" — finish this screen and return to the surrounding init
  // flow. Routes through the confirm phase so the user sees a diff (or the
  // no-changes screen) before anything is written.
  if (key.str === "n") {
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
    return { ...state, phase: "browse", status: copy.tokens.addCancelled };
  }

  // ←/→ only meaningful while picking a category from the conventional list.
  // Cycles CATEGORY_PICKS with wraparound so the row reads as a real list.
  if (
    add.step === "category" &&
    add.categoryMode === "pick" &&
    (key.name === "left" || key.name === "right")
  ) {
    const delta = key.name === "right" ? 1 : -1;
    add.categoryPick = (add.categoryPick + delta + CATEGORY_PICKS.length) % CATEGORY_PICKS.length;
    add.category = CATEGORY_PICKS[add.categoryPick]!;
    add.error = "";
    return { ...state, add };
  }

  if (key.name === "backspace") {
    // Pick-mode category has no buffer to delete (it's a fixed-choice row);
    // free-text mode lets you trim the buffer like any text field.
    if (add.step === "category" && add.categoryMode === "freetext") {
      add.category = add.category.slice(0, -1);
    } else if (add.step === "name") add.name = add.name.slice(0, -1);
    else if (add.step === "value") add.value = add.value.slice(0, -1);
    add.error = "";
    return { ...state, add };
  }
  if (key.name === "return") {
    if (add.step === "category") {
      // "other" in pick mode pivots to free-text instead of committing —
      // gives the open-ended path without sacrificing the guided default.
      if (add.categoryMode === "pick" && add.category === "other") {
        add.categoryMode = "freetext";
        add.category = "";
        add.error = "";
        return { ...state, add };
      }
      if (!isValidIdent(add.category)) {
        add.error = copy.tokens.badIdent(copy.tokens.addFieldCategory);
        return { ...state, add };
      }
      add.step = "name";
      add.error = "";
      return { ...state, add };
    }
    if (add.step === "name") {
      if (!isValidIdent(add.name)) {
        add.error = copy.tokens.badIdent(copy.tokens.addFieldName);
        return { ...state, add };
      }
      if (
        state.rows.some(
          r => r.category === add.category && r.name === add.name
        )
      ) {
        add.error = copy.tokens.duplicate(`${add.category}.${add.name}`);
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
      add: {
        step: "category",
        categoryMode: "pick",
        categoryPick: 0,
        category: CATEGORY_PICKS[0],
        name: "",
        value: "",
        error: ""
      },
      status: copy.tokens.added(`${add.category}.${add.name}`)
    };
  }
  if (key.str && key.str.length === 1 && key.str >= " ") {
    if (add.step === "category") {
      // Typing a printable key while picking a category flips to free-text
      // and uses that key as the first character — the user clearly wants a
      // category we don't list, so the conventional choices step aside.
      if (add.categoryMode === "pick") {
        add.categoryMode = "freetext";
        add.category = key.str;
      } else {
        add.category += key.str;
      }
    } else if (add.step === "name") add.name += key.str;
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

/**
 * Pure renderer. Owns the WHOLE screen including the confirm/diff tail (the
 * driver no longer draws its own — that was the slice-4 dead-copy defect).
 * `theme` defaults to `plainTheme` (identity) so tests / `NO_COLOR` get
 * clean text; the driver passes `ansiTheme` and the precomputed `diff`.
 */
export function render(
  state: TokenPickerState,
  theme: Theme = plainTheme,
  diff = ""
): string {
  const L: string[] = [];
  L.push(theme.title(copy.tokens.title));
  L.push("");

  if (state.phase === "confirm") {
    if (!diff) {
      L.push(theme.hint(copy.review.noChanges));
      L.push("");
      L.push(renderLegend(copy.review.noChangesActions, theme));
      return L.join("\n");
    }
    for (const line of diff.split("\n")) {
      if (line.startsWith("+")) L.push(theme.diffAdd(line));
      else if (line.startsWith("-")) L.push(theme.diffDel(line));
      else L.push(theme.hint(line));
    }
    L.push("");
    L.push(copy.review.prompt);
    L.push(renderLegend(copy.review.actions, theme));
    return L.join("\n");
  }

  if (state.phase === "add") {
    const a = state.add;
    L.push(theme.title(copy.tokens.addTitle));
    L.push("");
    // Don't nest theme spans: the active field's label gets `cursor`, its
    // value gets `editing`, joined raw. (The ui/style wrappers all close
    // with the same SGR reset, so a span-in-span loses the outer colour
    // after the inner reset — keep them siblings, never nested.)
    const textField = (key: AddDraft["step"], label: string, val: string): string => {
      const active = a.step === key;
      const mark = active ? glyph.cursor : glyph.cursorOff;
      const prefix = `${mark} ${label.padEnd(8)} `;
      if (!active) return `${prefix}${val}`;
      return `${theme.cursor(prefix)}${theme.editing(`${val}${glyph.caret}`)}`;
    };

    // Category row: a pick-list when categoryMode === "pick", otherwise a
    // free-text editor (same shape as the other two fields).
    const catActive = a.step === "category";
    const catMark = catActive ? glyph.cursor : glyph.cursorOff;
    const catPrefix = `${catMark} ${copy.tokens.addFieldCategory.padEnd(8)} `;
    if (a.categoryMode === "pick") {
      // ◉ color  ○ size  ○ font  ○ space  ○ other — selected one gets
      // theme.editing if the row is active, the rest stay neutral.
      const picks = CATEGORY_PICKS.map((p, i) => {
        const radio = i === a.categoryPick ? glyph.radioOn : glyph.radioOff;
        const label = `${radio} ${p}`;
        return i === a.categoryPick && catActive ? theme.editing(label) : label;
      }).join("  ");
      L.push(`${catActive ? theme.cursor(catPrefix) : catPrefix}${picks}`);
    } else {
      L.push(textField("category", copy.tokens.addFieldCategory, a.category));
    }
    L.push(textField("name", copy.tokens.addFieldName, a.name));
    L.push(textField("value", copy.tokens.addFieldValue, a.value));

    // Contextual hint under the active field — guides format without
    // gating (categories stay open-ended; value formats are advisory).
    if (a.step === "category") {
      L.push("");
      L.push(theme.hint(
        a.categoryMode === "pick"
          ? copy.tokens.categoryPickHint
          : copy.tokens.categoryFreetextHint
      ));
    } else if (a.step === "value") {
      const hint = copy.tokens.valueHint(a.category);
      if (hint) {
        L.push("");
        L.push(theme.hint(hint));
      }
    }

    if (a.error) {
      L.push("");
      L.push(theme.err(`${glyph.err} ${a.error}`));
    }
    L.push("");
    // Legend swaps the active-keys hint based on the category mode.
    const legend = a.step === "category" && a.categoryMode === "pick"
      ? copy.tokens.addLegendCategoryPick
      : copy.tokens.addLegend;
    L.push(renderLegend(legend, theme));
    return L.join("\n");
  }

  L.push(renderLegend(copy.tokens.legend, theme));
  L.push("");

  if (state.rows.length === 0) {
    // Empty state: full intro paragraph + examples (rendered dim), then a
    // blank line and the explicit call-to-action themed `ok` so it reads
    // as the next thing to do rather than more explanatory body text.
    for (const line of copy.tokens.emptyIntro.split("\n")) {
      L.push(theme.hint(line));
    }
    L.push("");
    L.push(theme.ok(copy.tokens.emptyCallToAction));
  } else {
    // Populated: short orientation block above the list — names what
    // tokens *do* (build-time substitution), so a returning user gets
    // reminded without re-reading the full empty-state intro.
    for (const line of copy.tokens.orientation.split("\n")) {
      L.push(theme.hint(line));
    }
    L.push("");
    const w = Math.max(
      ...state.rows.map(r => `${r.category}.${r.name}`.length)
    );
    for (let i = 0; i < state.rows.length; i++) {
      const r = state.rows[i]!;
      const onCursor = i === state.cursor;
      const mark = onCursor ? glyph.cursor : glyph.cursorOff;
      const path = `${r.category}.${r.name}`.padEnd(w);
      const editing = state.phase === "edit" && onCursor;
      // Keep theme spans as siblings, never nested (see the add-field note):
      // colour the "mark path" prefix, then the value/tag separately.
      const prefix = `${mark} ${path}  `;
      // While editing: show the live buffer + caret, plus a dimmed
      // "current: <old>" hint so the user can choose to keep, replace, or
      // ↵-on-empty to keep. Empty hint when there's nothing to keep.
      const val = editing
        ? `${theme.editing(`${state.buffer}${glyph.caret}`)}${
            r.value ? `   ${theme.hint(`current: ${r.value}`)}` : ""
          }`
        : r.value;
      const tag = r.added ? ` ${theme.added(`(${copy.tokens.newTag})`)}` : "";
      L.push(`${onCursor ? theme.cursor(prefix) : prefix}${val}${tag}`);
    }

    // Advisory contrast hint when the conventional color.ink / color.page
    // pair both look like hex — not a gate, just guidance. Coloured by how
    // it scores so a bad pair reads as a warning, not neutral chrome.
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
      const rating =
        ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large only" : "too low";
      const msg = copy.tokens.contrast(ratio, rating);
      L.push("");
      L.push(
        ratio >= 4.5 ? theme.ok(`${glyph.ok} ${msg}`)
          : ratio >= 3 ? theme.warn(`${glyph.warn} ${msg}`)
          : theme.err(`${glyph.err} ${msg}`)
      );
    }
  }

  if (state.status) {
    L.push("");
    const isErr = / already exists\.$| must be /.test(state.status);
    L.push(isErr ? theme.err(state.status) : theme.hint(state.status));
  }
  return L.join("\n");
}
