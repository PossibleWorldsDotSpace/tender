import { join } from "node:path";
import type { LintFinding } from "../report.js";
import type { ProjectConfig } from "../../config/schema.js";

export interface TokensCheckInput {
  projectDir: string;
  tokens: ProjectConfig["design-tokens"];
}

const CSS_NAMED_COLORS = new Set([
  // Pragmatic subset — common ones. Authors can use any value with the
  // CSS color() function or hex; named colors are the typo-prone shape.
  "black", "white", "red", "green", "blue", "yellow", "cyan", "magenta",
  "gray", "grey", "silver", "maroon", "olive", "lime", "aqua", "teal",
  "navy", "fuchsia", "purple", "orange", "pink", "brown", "rebeccapurple",
  "transparent", "currentcolor", "inherit", "initial", "unset"
]);

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Intentionally shallow: validates the function head only (e.g. rgb(...)), not
// the contents inside the parens. A typo-catcher; not a CSS validator.
const FUNC_RE = /^(rgb|rgba|hsl|hsla|color|oklch|lch|lab)\(.+\)$/;
const LENGTH_RE = /^-?\d+(\.\d+)?(mm|cm|in|pt|px|em|rem|%|ch|ex|vh|vw|vmin|vmax)$/;

function isValidColor(v: string): boolean {
  if (HEX_RE.test(v)) return true;
  if (FUNC_RE.test(v)) return true;
  if (CSS_NAMED_COLORS.has(v.toLowerCase())) return true;
  return false;
}

function isValidLength(v: string): boolean {
  if (v === "0") return true;
  if (v.startsWith("calc(") || v.startsWith("var(")) return true;
  return LENGTH_RE.test(v);
}

function isValidLeading(v: string | number): boolean {
  if (typeof v === "number") return true;
  return /^-?\d+(\.\d+)?$/.test(v);
}

const VALID_WEIGHTS = new Set([
  "normal", "bold", "lighter", "bolder",
  "100", "200", "300", "400", "500", "600", "700", "800", "900"
]);

function isValidWeight(v: string | number): boolean {
  return VALID_WEIGHTS.has(String(v));
}

export function checkTokens(input: TokensCheckInput): LintFinding[] {
  const findings: LintFinding[] = [];
  if (!input.tokens) return findings;
  const path = join(input.projectDir, "project.yaml");

  for (const [category, group] of Object.entries(input.tokens)) {
    if (!group) continue;
    for (const [name, value] of Object.entries(group)) {
      const ref = `${category}.${name}`;
      const v = String(value);
      let ok = true;
      let expected: string | null = null;
      if (category === "color") {
        if (!isValidColor(v)) {
          ok = false;
          expected = "a CSS color (hex, rgb()/hsl()/oklch(), or a named color)";
        }
      } else if (category === "size" || category === "space") {
        if (!isValidLength(v)) {
          ok = false;
          expected = "a CSS length (e.g. 12pt, 8mm, 1em, 50%), 0, or a calc()/var() expression";
        }
      } else if (category === "leading") {
        if (!isValidLeading(value)) {
          ok = false;
          expected = "a unitless number";
        }
      } else if (category === "weight") {
        if (!isValidWeight(value)) {
          ok = false;
          expected = "a CSS font-weight (100–900 in 100s, normal, bold)";
        }
      }
      if (!ok) {
        findings.push({
          code: "tender/token-value-shape",
          severity: "warning",
          path,
          message: `Token "${ref}" value ${JSON.stringify(value)} doesn't look like ${expected}.`
        });
      }
    }
  }
  return findings;
}
