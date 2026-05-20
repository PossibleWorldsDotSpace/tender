/**
 * Page-setup screen as a PURE state machine. `reduce(state, key)` and
 * `render(state)` are total functions the driver wires to real I/O; this
 * split keeps the whole interaction unit-testable without a pseudo-TTY.
 *
 * Scope (#17, expanded after slice-5 review): two-level navigation —
 *
 *   list view      one row per page template (default, cover, …)
 *                  with a compact summary. ↵ drills into a template;
 *                  `a` adds a new template; `s` reviews & applies all
 *                  pending changes across every template.
 *
 *   template view  size, four margin boxes, headers (mode + 3 slots),
 *                  footers (mode + 3 slots). Esc returns to the list.
 *
 * The two views share one underlying draft store keyed by template name, so
 * a user can flip between templates, edit several, and review once at the
 * end — `collectEdits` always sees the whole change set.
 *
 * `default` is immutable for safety: it can't be removed or renamed
 * (#17 follow-up decision). Other templates can be added; verso/recto
 * headers, rename, and remove are tracked under #18.
 */

import type { ProjectConfig } from "@tender/core";
import {
  cycleUnit, formatLength, parseLength,
  NAMED_PAGE_SIZES, type NamedPageSize, type LengthUnit,
  parsePageSize, parseMargin,
  type PageSizeValue, type MarginValue
} from "./values.js";
import type { Edit, HeaderFooterValue } from "./document.js";
import { glyph, copy, plainTheme, type Theme } from "./theme.js";

/** The minimal subset of node's readline.Key the reducer needs; the driver
 * maps keypress events onto this. */
export interface KeyEvent {
  str?: string;
  name?: string;
}

const MARGIN_KEYS = ["top", "bottom", "inner", "outer"] as const;
type MarginKey = (typeof MARGIN_KEYS)[number];

const SLOT_KEYS = ["left", "center", "right"] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

/**
 * Field discriminator. The list view emits one `template-row` per template
 * plus a single synthetic `add-template-row` at the bottom (so the add-flow
 * is a first-class navigable row, not just a hidden shortcut); the
 * template view emits the size/margin/header/footer rows for one template.
 */
export type Field =
  | { kind: "template-row"; template: string }
  | { kind: "add-template-row" }
  | { kind: "size"; template: string }
  | { kind: "margin"; template: string; box: MarginKey }
  | { kind: "header-mode"; template: string }
  | { kind: "header-slot"; template: string; slot: SlotKey }
  | { kind: "footer-mode"; template: string }
  | { kind: "footer-slot"; template: string; slot: SlotKey };

interface SizeDraft {
  mode: "named" | "custom";
  name: NamedPageSize;
  width: string;
  height: string;
  customEdit?: "width" | "height";
  buffer: string;
}

interface MarginDraft {
  zero: boolean;
  value: number;
  unit: LengthUnit;
}

/** Header or footer draft per template. `none` → emit the literal "none"
 * back to YAML; `boxes` → emit a `{left, center, right}` map (omitting
 * empty slots). */
interface HFDraft {
  mode: "none" | "boxes";
  left: string;
  center: string;
  right: string;
  /** Which slot is being text-edited, if any (template-view only). */
  editing?: SlotKey;
  buffer: string;
  /** True when this draft came from a project that *had* a headers/footers
   * key but it was empty — distinguishes "user pressed return on a blank
   * slot" from "the project never had this set". */
  originated: boolean;
}

/** Sub-flow for adding a new template. The user is asked just for a name;
 * everything else inherits sensible defaults the user can immediately edit
 * in the template view. */
interface AddTemplateDraft {
  buffer: string;
  error: string;
}

export interface PageSetupState {
  templates: string[];
  /** Which view we're rendering. List = the template chooser; template =
   * editing one template's fields. Orthogonal to `phase`. */
  view: "list" | "template";
  /** Set iff view === "template". */
  currentTemplate?: string;
  fields: Field[];
  cursor: number;
  /** Per-template drafts. */
  size: Record<string, SizeDraft>;
  margin: Record<string, Record<MarginKey, MarginDraft>>;
  headers: Record<string, HFDraft>;
  footers: Record<string, HFDraft>;
  /** Snapshot of all four drafts at init for no-op detection. */
  initial: {
    size: Record<string, SizeDraft>;
    margin: Record<string, Record<MarginKey, MarginDraft>>;
    headers: Record<string, HFDraft>;
    footers: Record<string, HFDraft>;
  };
  /** Original template name set; templates added during this session are
   * those in `templates` but not in `initialTemplates`. */
  initialTemplates: string[];
  /** Add-template sub-flow, set iff the user pressed `a` on the list. */
  add?: AddTemplateDraft;
  /** Lifecycle: editing → confirm (diff shown) → done | cancelled. */
  phase: "edit" | "confirm" | "done" | "cancelled";
  status: string;
}

function defaultMarginDraft(): MarginDraft {
  return { zero: false, value: 0, unit: "mm" };
}

function defaultHFDraft(): HFDraft {
  return { mode: "none", left: "", center: "", right: "", buffer: "", originated: false };
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

/** Build an HFDraft from whatever the config has under `headers` / `footers`.
 * Schema accepts `"none" | {left, center, right} | {left-page, right-page}`;
 * the verso/recto split is deferred (#18) — fall back to `none` mode if
 * encountered, so existing verso/recto configs don't get silently rewritten. */
function hfDraftFrom(raw: unknown): HFDraft {
  if (raw === undefined) return defaultHFDraft();
  if (raw === "none") {
    return { ...defaultHFDraft(), mode: "none", originated: true };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    // Verso/recto split present → out of scope for this slice; treat as
    // none-mode but flag originated so we don't accidentally clobber it on
    // an Enter-through (the no-op compare will mark it unchanged).
    if ("left-page" in r || "right-page" in r) {
      return { ...defaultHFDraft(), mode: "none", originated: true };
    }
    return {
      mode: "boxes",
      left: typeof r.left === "string" ? r.left : "",
      center: typeof r.center === "string" ? r.center : "",
      right: typeof r.right === "string" ? r.right : "",
      buffer: "",
      originated: true
    };
  }
  return defaultHFDraft();
}

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** Recompute the field list for the given view + current template. */
function fieldsFor(state: Pick<PageSetupState, "view" | "currentTemplate" | "templates">): Field[] {
  if (state.view === "list") {
    return [
      ...state.templates.map(t => ({ kind: "template-row", template: t } as const)),
      { kind: "add-template-row" } as const
    ];
  }
  const t = state.currentTemplate!;
  const fs: Field[] = [{ kind: "size", template: t }];
  for (const box of MARGIN_KEYS) fs.push({ kind: "margin", template: t, box });
  fs.push({ kind: "header-mode", template: t });
  for (const slot of SLOT_KEYS) fs.push({ kind: "header-slot", template: t, slot });
  fs.push({ kind: "footer-mode", template: t });
  for (const slot of SLOT_KEYS) fs.push({ kind: "footer-slot", template: t, slot });
  return fs;
}

/**
 * Build initial state from the project config. Starts on the list view so
 * a user always sees their templates first.
 */
export function initPageSetup(config: ProjectConfig): PageSetupState {
  const pts = (config["page-templates"] ?? {}) as Record<string, Record<string, unknown>>;
  const templates = Object.keys(pts);
  const size: PageSetupState["size"] = {};
  const margin: PageSetupState["margin"] = {};
  const headers: PageSetupState["headers"] = {};
  const footers: PageSetupState["footers"] = {};
  for (const t of templates) {
    const tpl = pts[t] ?? {};
    size[t] = sizeDraftFrom(
      parsePageSize((tpl.size as string | [string, string]) ?? "A4")
    );
    margin[t] = marginDraftsFrom(parseMargin(tpl.margin ?? 0));
    headers[t] = hfDraftFrom(tpl.headers);
    footers[t] = hfDraftFrom(tpl.footers);
  }
  const base: Pick<PageSetupState, "view" | "currentTemplate" | "templates"> = {
    view: "list",
    currentTemplate: undefined,
    templates
  };
  return {
    templates,
    view: "list",
    currentTemplate: undefined,
    fields: fieldsFor(base),
    cursor: 0,
    size,
    margin,
    headers,
    footers,
    initial: {
      size: clone(size),
      margin: clone(margin),
      headers: clone(headers),
      footers: clone(footers)
    },
    initialTemplates: [...templates],
    phase: "edit",
    status: ""
  };
}

const NAMED = NAMED_PAGE_SIZES as readonly NamedPageSize[];

function cycleNamed(name: NamedPageSize, dir: 1 | -1): NamedPageSize {
  const i = NAMED.indexOf(name);
  return NAMED[(i + dir + NAMED.length) % NAMED.length]!;
}

const IDENT_RE = /^[a-z][a-z0-9-]*$/;

/* ---------- reduce ----------------------------------------------------- */

/**
 * Total reducer. Returns the next state; never mutates `state`. The driver
 * calls this on every keypress and re-renders the result.
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

  // Add-template sub-flow takes input until cancelled or committed.
  if (state.add) return reduceAddTemplate(state, key);

  return state.view === "list" ? reduceList(state, key) : reduceTemplate(state, key);
}

function reduceList(state: PageSetupState, key: KeyEvent): PageSetupState {
  if (key.name === "escape") return { ...state, phase: "cancelled" };
  if (key.name === "up") {
    return { ...state, cursor: Math.max(0, state.cursor - 1), status: "" };
  }
  if (key.name === "down") {
    return {
      ...state,
      // Includes the trailing add-template-row, so the cursor can land on it.
      cursor: Math.min(Math.max(0, state.fields.length - 1), state.cursor + 1),
      status: ""
    };
  }
  if (key.name === "return") {
    const row = state.fields[state.cursor];
    if (!row) return state;
    if (row.kind === "add-template-row") {
      return { ...state, add: { buffer: "", error: "" }, status: "" };
    }
    if (row.kind === "template-row") {
      return enterTemplate(state, row.template);
    }
    return state;
  }
  // Keyboard shortcut: `a` still opens the add flow from anywhere on the
  // list, so power users don't have to navigate to the bottom row.
  if (key.str === "a") {
    return { ...state, add: { buffer: "", error: "" }, status: "" };
  }
  if (key.str === "s") {
    return { ...state, phase: "confirm", status: "" };
  }
  return state;
}

function enterTemplate(state: PageSetupState, template: string): PageSetupState {
  const base = { view: "template" as const, currentTemplate: template, templates: state.templates };
  return {
    ...state,
    view: "template",
    currentTemplate: template,
    fields: fieldsFor(base),
    cursor: 0,
    status: ""
  };
}

function exitToList(state: PageSetupState): PageSetupState {
  const base = { view: "list" as const, currentTemplate: undefined, templates: state.templates };
  // Place the cursor back on the template we came from.
  const cursor = Math.max(0, state.templates.indexOf(state.currentTemplate ?? ""));
  return {
    ...state,
    view: "list",
    currentTemplate: undefined,
    fields: fieldsFor(base),
    cursor,
    status: ""
  };
}

function reduceAddTemplate(state: PageSetupState, key: KeyEvent): PageSetupState {
  const add = { ...state.add! };
  if (key.name === "escape") {
    return { ...state, add: undefined, status: copy.page.addCancelled };
  }
  if (key.name === "backspace") {
    add.buffer = add.buffer.slice(0, -1);
    add.error = "";
    return { ...state, add };
  }
  if (key.name === "return") {
    const name = add.buffer.trim();
    if (!IDENT_RE.test(name)) {
      add.error = copy.page.addBadName;
      return { ...state, add };
    }
    if (state.templates.includes(name)) {
      add.error = copy.page.addDuplicate(name);
      return { ...state, add };
    }
    // Commit: append the template with sensible defaults (A4, 20mm box),
    // close the sub-flow, jump straight into the new template's screen so
    // the user can immediately tune it.
    const templates = [...state.templates, name];
    const size = { ...state.size, [name]: sizeDraftFrom({ kind: "named", name: "A4" }) };
    const margin = {
      ...state.margin,
      [name]: marginDraftsFrom({
        kind: "box", top: "20mm", bottom: "20mm", inner: "20mm", outer: "20mm"
      })
    };
    const headers = { ...state.headers, [name]: defaultHFDraft() };
    const footers = { ...state.footers, [name]: defaultHFDraft() };
    return enterTemplate(
      {
        ...state,
        templates,
        size,
        margin,
        headers,
        footers,
        add: undefined,
        status: ""
      },
      name
    );
  }
  if (key.str && key.str.length === 1 && key.str >= " ") {
    add.buffer += key.str;
    add.error = "";
    return { ...state, add };
  }
  return state;
}

function reduceTemplate(state: PageSetupState, key: KeyEvent): PageSetupState {
  const field = state.fields[state.cursor];
  if (!field) return state;

  // Esc behaviour depends on what we're text-editing:
  //  - editing a custom dimension → cancel that edit only
  //  - editing a header/footer slot → cancel that edit only
  //  - otherwise → return to the list view (NOT the whole-screen cancel;
  //    the list-view esc handles that for the whole flow).
  if (key.name === "escape") {
    if (field.kind === "size" && state.size[field.template]!.customEdit) {
      const s = clone(state.size[field.template]!);
      s.customEdit = undefined;
      s.buffer = "";
      return setSize(state, field.template, s, copy.page.editCancelled);
    }
    if ((field.kind === "header-slot" || field.kind === "footer-slot")) {
      const which = field.kind === "header-slot" ? state.headers : state.footers;
      const hf = clone(which[field.template]!);
      if (hf.editing) {
        hf.editing = undefined;
        hf.buffer = "";
        return setHF(state, field.kind === "header-slot" ? "headers" : "footers",
          field.template, hf, copy.page.editCancelled);
      }
    }
    return exitToList(state);
  }

  // Per-field reducers.
  switch (field.kind) {
    case "size":     return reduceSize(state, field.template, key);
    case "margin":   return reduceMargin(state, field.template, field.box, key);
    case "header-mode":
    case "footer-mode":
      return reduceHFMode(state, field.kind === "header-mode" ? "headers" : "footers",
        field.template, key);
    case "header-slot":
    case "footer-slot":
      return reduceHFSlot(state, field.kind === "header-slot" ? "headers" : "footers",
        field.template, field.slot, key);
    default:
      return state;
  }
}

function reduceSize(state: PageSetupState, template: string, key: KeyEvent): PageSetupState {
  const s = clone(state.size[template]!);
  if (s.customEdit) {
    if (key.name === "return") {
      s.customEdit = undefined; s.buffer = "";
      return setSize(state, template, s, "");
    }
    if (key.name === "backspace") {
      s.buffer = s.buffer.slice(0, -1);
      if (s.customEdit === "width") s.width = s.buffer;
      else s.height = s.buffer;
      return setSize(state, template, s, "");
    }
    if (key.str && key.str.length === 1 && key.str >= " ") {
      s.buffer += key.str;
      if (s.customEdit === "width") s.width = s.buffer;
      else s.height = s.buffer;
      return setSize(state, template, s, "");
    }
    return state;
  }
  if (key.name === "up") return move(state, -1);
  if (key.name === "down") return move(state, 1);
  if (key.name === "return") return toConfirm(state);
  if (key.str === "c") {
    s.mode = s.mode === "named" ? "custom" : "named";
    return setSize(state, template, s,
      s.mode === "custom" ? copy.page.sizeCustomEntered : "");
  }
  if (s.mode === "named" && (key.name === "left" || key.name === "right")) {
    s.name = cycleNamed(s.name, key.name === "right" ? 1 : -1);
    return setSize(state, template, s, "");
  }
  if (s.mode === "custom" && (key.str === "w" || key.str === "h")) {
    s.customEdit = key.str === "w" ? "width" : "height";
    s.buffer = "";
    return setSize(state, template, s, copy.page.sizeTypeHint(s.customEdit));
  }
  return state;
}

function reduceMargin(
  state: PageSetupState, template: string, box: MarginKey, key: KeyEvent
): PageSetupState {
  const md = clone(state.margin[template]![box]);
  if (key.name === "up") return move(state, -1);
  if (key.name === "down") return move(state, 1);
  if (key.name === "return") return toConfirm(state);
  if (key.str === "z") {
    const next = clone(state.margin[template]!);
    const nowZero = !next[box].zero;
    for (const k of MARGIN_KEYS) next[k].zero = nowZero;
    return {
      ...state,
      margin: { ...state.margin, [template]: next },
      status: nowZero ? copy.page.marginToZero : copy.page.marginToBox
    };
  }
  if (md.zero) return { ...state, status: copy.page.marginZeroHint };
  if (key.str === "+" || key.str === "=" || key.name === "right") {
    md.value = Math.round((md.value + 1) * 1000) / 1000;
    return setMargin(state, template, box, md);
  }
  if (key.str === "-" || key.name === "left") {
    md.value = Math.round((md.value - 1) * 1000) / 1000;
    return setMargin(state, template, box, md);
  }
  if (key.str === "u") {
    md.unit = cycleUnit(md.unit, 1);
    return setMargin(state, template, box, md);
  }
  return state;
}

function reduceHFMode(
  state: PageSetupState, which: "headers" | "footers",
  template: string, key: KeyEvent
): PageSetupState {
  const hf = clone(state[which][template]!);
  if (key.name === "up") return move(state, -1);
  if (key.name === "down") return move(state, 1);
  if (key.name === "return") return toConfirm(state);
  if (key.name === "left" || key.name === "right") {
    hf.mode = hf.mode === "none" ? "boxes" : "none";
    return setHF(state, which, template, hf, "");
  }
  return state;
}

function reduceHFSlot(
  state: PageSetupState, which: "headers" | "footers",
  template: string, slot: SlotKey, key: KeyEvent
): PageSetupState {
  const hf = clone(state[which][template]!);
  // If the mode is "none", slot rows are inert (the renderer dims them);
  // ↵ flips to boxes-mode and starts editing, which feels like the right
  // shortcut: pressing Enter on a slot means "I want to type here".
  if (hf.editing) {
    if (key.name === "return") {
      // Empty buffer = "keep current" — leave the slot untouched (matches the
      // replace-on-type UX where the current value is shown beside an empty
      // editor and ↵ on empty preserves it).
      if (hf.buffer.length > 0) {
        hf[hf.editing] = hf.buffer;
      }
      hf.editing = undefined;
      hf.buffer = "";
      return setHF(state, which, template, hf, "");
    }
    if (key.name === "backspace") {
      hf.buffer = hf.buffer.slice(0, -1);
      return setHF(state, which, template, hf, "");
    }
    if (key.str && key.str.length === 1 && key.str >= " ") {
      hf.buffer += key.str;
      return setHF(state, which, template, hf, "");
    }
    return state;
  }
  if (key.name === "up") return move(state, -1);
  if (key.name === "down") return move(state, 1);
  if (key.name === "return") {
    // Auto-flip to boxes-mode if currently none — Enter on a slot is a
    // clear signal of intent. Buffer starts empty; the current value
    // renders beside the editor as a dimmed "current: …" hint.
    if (hf.mode === "none") hf.mode = "boxes";
    hf.editing = slot;
    hf.buffer = "";
    return setHF(state, which, template, hf, copy.page.slotTypeHint);
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

function setHF(
  state: PageSetupState, which: "headers" | "footers",
  template: string, hf: HFDraft, status: string
): PageSetupState {
  return {
    ...state,
    [which]: { ...state[which], [template]: hf },
    status
  };
}

function toConfirm(state: PageSetupState): PageSetupState {
  return { ...state, phase: "confirm", status: "" };
}

/* ---------- collectEdits ----------------------------------------------- */

/**
 * Compute the Edit[] for the whole pending change set across every
 * template. Empty array ⇒ a true no-op walk (Enter-through), which the
 * driver turns into "nothing to write". Newly added templates emit a
 * `page-template-add` plus any header/footer edits the user made on them.
 */
export function collectEdits(state: PageSetupState): Edit[] {
  const edits: Edit[] = [];
  const initialSet = new Set(state.initialTemplates);

  for (const t of state.templates) {
    const isNew = !initialSet.has(t);
    if (isNew) {
      // Emit the template-add with size+margin from the current draft (the
      // initial drafts only exist for templates that were there at init).
      const s = state.size[t]!;
      const m = state.margin[t]!;
      edits.push({
        kind: "page-template-add",
        template: t,
        value: { size: draftToPageSize(s), margin: draftToMargin(m) }
      });
    } else {
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

    // Headers + footers — newly added templates have a `defaultHFDraft()`
    // baseline, so a user who set anything on them produces an edit; on
    // existing templates we compare to the captured initial.
    const baselineH = isNew ? defaultHFDraft() : state.initial.headers[t]!;
    const baselineF = isNew ? defaultHFDraft() : state.initial.footers[t]!;
    if (!sameHF(state.headers[t]!, baselineH)) {
      edits.push({ kind: "page-headers", template: t, value: draftToHF(state.headers[t]!) });
    }
    if (!sameHF(state.footers[t]!, baselineF)) {
      edits.push({ kind: "page-footers", template: t, value: draftToHF(state.footers[t]!) });
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

function draftToHF(hf: HFDraft): HeaderFooterValue {
  if (hf.mode === "none") return "none";
  const out: { left?: string; center?: string; right?: string } = {};
  if (hf.left)   out.left   = hf.left;
  if (hf.center) out.center = hf.center;
  if (hf.right)  out.right  = hf.right;
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

function sameHF(a: HFDraft, b: HFDraft): boolean {
  return a.mode === b.mode &&
    a.left === b.left && a.center === b.center && a.right === b.right;
}

/** Validate text-entered custom dimensions across all templates; surfaced
 * by the driver before transitioning to confirm. */
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

/* ---------- render ----------------------------------------------------- */

/**
 * Pure renderer. Owns the full screen (title, body, confirm/diff). The
 * driver only clears the terminal and prints this. `theme` defaults to the
 * plain identity (no ANSI) for tests / NO_COLOR; the driver passes
 * `ansiTheme` plus the precomputed diff text.
 */
export function render(
  state: PageSetupState,
  theme: Theme = plainTheme,
  diff = ""
): string {
  const L: string[] = [];
  L.push(theme.title(copy.page.title));
  L.push("");

  if (state.phase === "confirm") return renderConfirm(L, theme, diff);
  if (state.add) return renderAddTemplate(L, state.add, theme);
  if (state.view === "list") return renderList(L, state, theme);
  return renderTemplate(L, state, theme);
}

function renderConfirm(L: string[], theme: Theme, diff: string): string {
  if (!diff) {
    L.push(theme.hint(copy.review.noChanges));
    return L.join("\n");
  }
  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) L.push(theme.diffAdd(line));
    else if (line.startsWith("-")) L.push(theme.diffDel(line));
    else L.push(theme.hint(line));
  }
  L.push("");
  L.push(copy.review.prompt);
  L.push(theme.hint(copy.review.actions));
  return L.join("\n");
}

function renderAddTemplate(L: string[], add: AddTemplateDraft, theme: Theme): string {
  L.push(theme.title(copy.page.addTitle));
  L.push("");
  const prefix = `${glyph.cursor} ${copy.page.addFieldName.padEnd(6)} `;
  L.push(`${theme.cursor(prefix)}${theme.editing(`${add.buffer}${glyph.caret}`)}`);
  L.push("");
  L.push(theme.hint(copy.page.addNameHint));
  if (add.error) {
    L.push("");
    L.push(theme.err(`${glyph.err} ${add.error}`));
  }
  L.push("");
  L.push(theme.hint(copy.page.addLegend));
  return L.join("\n");
}

function renderList(L: string[], state: PageSetupState, theme: Theme): string {
  L.push(theme.hint(copy.page.listLegend));
  L.push("");
  // Intro reads differently depending on whether the project already has
  // more than just the default template — first-time users need to learn
  // that multiple templates are possible (and optional); experienced users
  // just want to see and edit their list.
  const intro = state.templates.length <= 1
    ? copy.page.listIntroSingle
    : copy.page.listIntro;
  L.push(theme.hint(intro));
  L.push("");

  // Compute a summary per template: size + a margin shape descriptor.
  // `padEnd` width includes the synthetic add-row's visible label so the
  // alignment between template rows and the add row reads coherently.
  const w = Math.max(
    ...state.templates.map(t => t.length),
    copy.page.addRowLabel.length
  );
  for (let i = 0; i < state.fields.length; i++) {
    const f = state.fields[i]!;
    const onCursor = i === state.cursor;
    const mark = onCursor ? glyph.cursor : glyph.cursorOff;

    if (f.kind === "add-template-row") {
      // Visually distinct: the `+` glyph marks it as a create action, and
      // the label is dimmed (it's a verb, not a piece of config). The
      // cursor still highlights it when focused.
      L.push("");
      const prefix = `${mark} ${theme.added(glyph.added)} ${copy.page.addRowLabel.padEnd(w - 2)}`;
      const hint = theme.hint(copy.page.addRowHint);
      L.push(`${onCursor ? theme.cursor(prefix) : prefix}  ${hint}`);
      continue;
    }
    // template-row
    const t = f.template;
    const sz = summarizeSize(state.size[t]!);
    const mg = summarizeMargin(state.margin[t]!);
    const tag = t === "default" ? ` ${theme.hint("(immutable)")}` : "";
    const prefix = `${mark} ${t.padEnd(w)}  `;
    const summary = theme.hint(copy.page.listRowSummary(sz, mg));
    L.push(`${onCursor ? theme.cursor(prefix) : prefix}${summary}${tag}`);
  }
  if (state.status) {
    L.push("");
    L.push(theme.hint(state.status));
  }
  return L.join("\n");
}

function summarizeSize(s: SizeDraft): string {
  return s.mode === "named" ? s.name : `${s.width} × ${s.height}`;
}

function summarizeMargin(m: Record<MarginKey, MarginDraft>): string {
  if (MARGIN_KEYS.every(k => m[k].zero)) return "0";
  // If all four boxes share value+unit, render the single value; else show
  // a compact T/B/I/O shorthand.
  const first = m.top;
  const uniform = MARGIN_KEYS.every(k =>
    !m[k].zero && m[k].value === first.value && m[k].unit === first.unit
  );
  if (uniform) return `${first.value}${first.unit}`;
  return MARGIN_KEYS.map(k => m[k].zero ? "0" : `${m[k].value}${m[k].unit}`).join("/");
}

function renderTemplate(L: string[], state: PageSetupState, theme: Theme): string {
  const t = state.currentTemplate!;
  L.push(theme.hint(`${copy.page.templateLegend}    template: ${t}`));
  L.push("");

  // Render sections with dividers. Track absolute row indices so the cursor
  // mark stays correct as we interleave dividers (dividers don't move the
  // cursor — `state.fields` indexes match the rows we draw).
  const sec = (label: string): void => {
    L.push(theme.hint(`— ${label} —`));
  };

  for (let i = 0; i < state.fields.length; i++) {
    const f = state.fields[i]!;
    if (i === 0) sec(copy.page.sectionPage);
    if (f.kind === "header-mode") { L.push(""); sec(copy.page.sectionHeaders); }
    if (f.kind === "footer-mode") { L.push(""); sec(copy.page.sectionFooters); }
    L.push(renderRow(f, state, i === state.cursor, theme));
  }

  // Context-sensitive sub-legend under the current row.
  const cf = state.fields[state.cursor];
  if (cf) {
    const sub = subLegendFor(cf, state);
    if (sub) {
      L.push("");
      L.push(theme.hint(sub));
    }
  }

  if (state.status) {
    L.push("");
    const isErr = /^Can't apply/.test(state.status);
    L.push(isErr ? theme.err(state.status) : theme.hint(state.status));
  }
  return L.join("\n");
}

function subLegendFor(f: Field, state: PageSetupState): string {
  switch (f.kind) {
    case "size": {
      const s = state.size[f.template]!;
      const base = s.mode === "named" ? copy.page.legendSizeNamed : copy.page.legendSizeCustom;
      // Editing a non-default template's size: the PDF's physical sheet
      // follows `default`. Non-default sizes only affect the *content area*
      // of pages marked with this template. Without this hint a user can
      // set cover=A5 in a default=A4 project and be surprised the sheet is
      // still A4 throughout.
      if (f.template !== "default") {
        return `${base}\n${copy.page.sizeDefaultGovernsSheetHint}`;
      }
      return base;
    }
    case "margin": return copy.page.legendMargin;
    case "header-mode":
    case "footer-mode": return copy.page.legendHeaderMode;
    case "header-slot":
    case "footer-slot": return copy.page.legendHeaderSlot;
    default: return "";
  }
}

function renderRow(f: Field, state: PageSetupState, onCursor: boolean, theme: Theme): string {
  const mark = onCursor ? glyph.cursor : glyph.cursorOff;
  let prefix: string;
  let val: string;
  switch (f.kind) {
    case "size": {
      const s = state.size[f.template]!;
      const radioNamed = s.mode === "named" ? glyph.radioOn : glyph.radioOff;
      const radioCustom = s.mode === "custom" ? glyph.radioOn : glyph.radioOff;
      if (s.mode === "named") {
        val = `${radioNamed} ${s.name}  ${radioCustom} custom`;
      } else {
        const w = s.customEdit === "width"
          ? theme.editing(`${s.buffer}${glyph.caret}`) : s.width;
        const h = s.customEdit === "height"
          ? theme.editing(`${s.buffer}${glyph.caret}`) : s.height;
        val = `${radioNamed} named  ${radioCustom} ${w} × ${h}`;
      }
      prefix = `${mark} size           `;
      break;
    }
    case "margin": {
      const m = state.margin[f.template]![f.box];
      val = m.zero ? "0" : `${m.value}${m.unit}`;
      prefix = `${mark} margin.${f.box.padEnd(6)} `;
      break;
    }
    case "header-mode": {
      const hf = state.headers[f.template]!;
      const radioNone = hf.mode === "none" ? glyph.radioOn : glyph.radioOff;
      const radioBoxes = hf.mode === "boxes" ? glyph.radioOn : glyph.radioOff;
      val = `${radioNone} none   ${radioBoxes} three slots`;
      prefix = `${mark} headers        `;
      break;
    }
    case "footer-mode": {
      const hf = state.footers[f.template]!;
      const radioNone = hf.mode === "none" ? glyph.radioOn : glyph.radioOff;
      const radioBoxes = hf.mode === "boxes" ? glyph.radioOn : glyph.radioOff;
      val = `${radioNone} none   ${radioBoxes} three slots`;
      prefix = `${mark} footers        `;
      break;
    }
    case "header-slot":
    case "footer-slot": {
      const hf = (f.kind === "header-slot" ? state.headers : state.footers)[f.template]!;
      const dimmed = hf.mode === "none";
      let raw: string;
      if (hf.editing === f.slot) {
        // Replace-on-type editor: empty buffer + dimmed "current: <old>"
        // hint beside it, so ↵ on empty keeps and typing replaces.
        const current = hf[f.slot];
        raw = `${theme.editing(`${hf.buffer}${glyph.caret}`)}${
          current ? `   ${theme.hint(`current: ${current}`)}` : ""
        }`;
      } else {
        raw = hf[f.slot] || theme.hint(copy.page.slotEmpty);
      }
      val = dimmed ? theme.hint(raw) : raw;
      const label = `${f.kind === "header-slot" ? "header" : "footer"}.${f.slot}`;
      prefix = `${mark} ${label.padEnd(15)}`;
      break;
    }
    default:
      prefix = `${mark} `;
      val = "";
  }
  return `${onCursor ? theme.cursor(prefix) : prefix}${val}`;
}
