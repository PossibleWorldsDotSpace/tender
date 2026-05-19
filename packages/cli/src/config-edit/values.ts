/**
 * Pure parse/format helpers for the foundational `project.yaml` fields the
 * interactive configurator edits: page size, margins, length+unit, color
 * hex. No I/O, no YAML — these are the leaf converters the AST layer and the
 * (later) TUI screens both build on. Mirrors the zod shapes in
 * packages/core/src/config/schema.ts.
 */

export const NAMED_PAGE_SIZES = ["A4", "A5", "A6", "Letter", "Legal"] as const;
export type NamedPageSize = (typeof NAMED_PAGE_SIZES)[number];

/** A length is a number plus one of the schema's accepted CSS units. */
export const LENGTH_UNITS = ["mm", "cm", "in", "pt", "px"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

const LENGTH_RE = /^(-?\d+(?:\.\d+)?)(mm|cm|in|pt|px)$/;

export interface Length {
  value: number;
  unit: LengthUnit;
}

/** Parse `"18mm"` → `{ value: 18, unit: "mm" }`. Returns null if malformed. */
export function parseLength(raw: string): Length | null {
  const m = LENGTH_RE.exec(raw.trim());
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] as LengthUnit };
}

/** Format `{ value: 18, unit: "mm" }` → `"18mm"`. Trims trailing `.0`. */
export function formatLength(len: Length): string {
  // Number() already drops a trailing .0; String() of an int has no decimal.
  return `${len.value}${len.unit}`;
}

export function isLengthUnit(s: string): s is LengthUnit {
  return (LENGTH_UNITS as readonly string[]).includes(s);
}

/** Cycle a unit forward (or backward) through LENGTH_UNITS — for steppers. */
export function cycleUnit(unit: LengthUnit, dir: 1 | -1 = 1): LengthUnit {
  const i = LENGTH_UNITS.indexOf(unit);
  const n = LENGTH_UNITS.length;
  return LENGTH_UNITS[(i + dir + n) % n]!;
}

/**
 * A page size is either a named size (A4…) or an explicit [width, height]
 * pair of length strings. This is the normalized in-memory shape; the YAML
 * round-trips it back to a string or a 2-element sequence.
 */
export type PageSizeValue =
  | { kind: "named"; name: NamedPageSize }
  | { kind: "custom"; width: string; height: string };

export function isNamedPageSize(s: string): s is NamedPageSize {
  return (NAMED_PAGE_SIZES as readonly string[]).includes(s);
}

/**
 * Normalize a raw `size:` value (string or `[w, h]`) into PageSizeValue.
 * Unknown strings are treated as a custom square (w === h) — same lenient
 * fallback as core's pageSizeToWidthHeight; the configurator surfaces it as
 * custom so the user can correct it rather than silently rejecting.
 */
export function parsePageSize(raw: string | [string, string]): PageSizeValue {
  if (Array.isArray(raw)) return { kind: "custom", width: raw[0], height: raw[1] };
  if (isNamedPageSize(raw)) return { kind: "named", name: raw };
  return { kind: "custom", width: raw, height: raw };
}

/** Render PageSizeValue back to what YAML should hold. */
export function formatPageSize(v: PageSizeValue): string | [string, string] {
  return v.kind === "named" ? v.name : [v.width, v.height];
}

/**
 * Margin as the schema allows it: the literal `0`, or an object with any of
 * top/bottom/inner/outer (we don't surface left/right in the configurator —
 * inner/outer is the print-correct vocabulary — but parsing tolerates them).
 */
export type MarginValue =
  | { kind: "zero" }
  | {
      kind: "box";
      top?: string;
      bottom?: string;
      inner?: string;
      outer?: string;
    };

export function parseMargin(raw: unknown): MarginValue | null {
  if (raw === 0) return { kind: "zero" };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const pick = (k: string, alt?: string): string | undefined => {
      const v = o[k] ?? (alt ? o[alt] : undefined);
      return typeof v === "string" ? v : undefined;
    };
    return {
      kind: "box",
      top: pick("top"),
      bottom: pick("bottom"),
      inner: pick("inner", "left"),
      outer: pick("outer", "right")
    };
  }
  return null;
}

/** Render MarginValue back to the YAML shape (the literal 0, or an object). */
export function formatMargin(v: MarginValue): 0 | Record<string, string> {
  if (v.kind === "zero") return 0;
  const out: Record<string, string> = {};
  for (const k of ["top", "bottom", "inner", "outer"] as const) {
    const val = v[k];
    if (val !== undefined) out[k] = val;
  }
  return out;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Normalize a color hex to `#rrggbb` lowercase. Accepts 3- or 6-digit,
 * optional leading `#`. Returns null if it isn't a hex color (the token
 * value may legitimately be a non-color string — caller decides).
 */
export function normalizeHex(raw: string): string | null {
  const m = HEX_RE.exec(raw.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return `#${h}`;
}
