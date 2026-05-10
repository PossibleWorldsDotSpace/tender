import type { ProjectConfig } from "../config/schema.js";

export interface ProjectCssOptions {
  docTitle?: string;
}

const TOKEN_MAP: Record<string, string> = {
  "{page}": "counter(page)",
  "{pages}": "counter(pages)",
  "{title}": "string(title)",
  "{chapter}": "string(chapter)",
  "{section}": "string(section)"
};

interface MarginBoxes {
  left?: string;
  center?: string;
  right?: string;
}

interface VersoRecto {
  "left-page"?: MarginBoxes;
  "right-page"?: MarginBoxes;
}

type HeaderFooter = "none" | MarginBoxes | VersoRecto;

interface PageTemplateLike {
  size: string | [string, string];
  margin: unknown;
  bleed?: string;
  headers?: HeaderFooter;
  footers?: HeaderFooter;
  "headers-rest"?: MarginBoxes | VersoRecto;
  "footers-rest"?: MarginBoxes | VersoRecto;
}

/**
 * The normalized shape we emit CSS from. One per page template, regardless of
 * how its headers/footers were configured. Every branch in the resolver below
 * collapses into this shape so the CSS-emission stage has no branching.
 *
 * Rules to emit per template (only those with at least one populated box are
 * emitted; the base `@page name { … }` always emits because it carries size
 * and margin):
 *
 *   @page name           — base rule (size + margin)
 *   @page name:first     — first page only; null when there is no first/rest split
 *   @page name:left      — verso pages; null when there is no verso/recto split
 *   @page name:right     — recto pages; null when there is no verso/recto split
 *
 * When verso/recto is in play, the base rule has no header/footer boxes —
 * those go on :left and :right. When first-page suppression is in play, the
 * :first rule has no header/footer boxes; the rest go on the base rule (or on
 * :left/:right if combined with verso/recto).
 */
interface ResolvedPageTemplate {
  name: string;
  raw: PageTemplateLike;
  baseHeader: MarginBoxes | undefined;
  baseFooter: MarginBoxes | undefined;
  hasFirstSuppression: boolean;
  hasVersoRecto: boolean;
  leftHeader: MarginBoxes | undefined;
  leftFooter: MarginBoxes | undefined;
  rightHeader: MarginBoxes | undefined;
  rightFooter: MarginBoxes | undefined;
}

function expandToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed in TOKEN_MAP) return TOKEN_MAP[trimmed]!;
  // If the string contains a token-shaped substring but isn't a pure token, error.
  if (/\{(page|pages|title|chapter|section)\}/.test(trimmed)) {
    throw new Error(`Header/footer values must be either a single token or pure literal in v1; got: ${trimmed}`);
  }
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

function isVersoRecto(c: unknown): c is VersoRecto {
  return typeof c === "object" && c !== null && ("left-page" in c || "right-page" in c);
}

function isMarginBoxes(c: unknown): c is MarginBoxes {
  if (typeof c !== "object" || c === null) return false;
  if (isVersoRecto(c)) return false;
  return true;
}

/**
 * Pull the boxes that apply to a single side (verso or recto). Accepts either
 * a uniform MarginBoxes (which applies to both sides) or a VersoRecto. Returns
 * undefined for "none" or absent.
 */
function sideBoxes(c: HeaderFooter | MarginBoxes | VersoRecto | undefined, side: "left-page" | "right-page"): MarginBoxes | undefined {
  if (!c || c === "none") return undefined;
  if (isVersoRecto(c)) return c[side];
  if (isMarginBoxes(c)) return c;
  return undefined;
}

function uniformBoxes(c: HeaderFooter | undefined): MarginBoxes | undefined {
  if (!c || c === "none") return undefined;
  if (isVersoRecto(c)) return undefined;
  return c;
}

/**
 * Collapse a page template's raw config into the normalized shape above.
 * This is the only place that branches on "is this verso/recto?" / "does
 * this template suppress headers on the first page?" — once we have a
 * ResolvedPageTemplate, emitting CSS is mechanical.
 */
function resolvePageTemplate(name: string, raw: PageTemplateLike): ResolvedPageTemplate {
  const hasFirstSuppression =
    (raw.headers === "none" && raw["headers-rest"] !== undefined) ||
    (raw.footers === "none" && raw["footers-rest"] !== undefined);

  // Pick whichever values describe the *non-first* pages. When first-page
  // suppression is on, that's `headers-rest` / `footers-rest`. Otherwise
  // fall back to the regular `headers` / `footers`.
  const restHeaders: MarginBoxes | VersoRecto | undefined = hasFirstSuppression
    ? (raw.headers === "none" ? raw["headers-rest"] : (raw["headers-rest"] ?? (raw.headers as MarginBoxes | VersoRecto | undefined)))
    : (raw.headers && raw.headers !== "none" ? (raw.headers as MarginBoxes | VersoRecto) : undefined);
  const restFooters: MarginBoxes | VersoRecto | undefined = hasFirstSuppression
    ? (raw.footers === "none" ? raw["footers-rest"] : (raw["footers-rest"] ?? (raw.footers as MarginBoxes | VersoRecto | undefined)))
    : (raw.footers && raw.footers !== "none" ? (raw.footers as MarginBoxes | VersoRecto) : undefined);

  const hasVersoRecto =
    isVersoRecto(restHeaders) ||
    isVersoRecto(restFooters) ||
    isVersoRecto(raw.headers) ||
    isVersoRecto(raw.footers) ||
    isVersoRecto(raw["headers-rest"]) ||
    isVersoRecto(raw["footers-rest"]);

  if (hasVersoRecto) {
    // Verso/recto: header/footer boxes belong on :left and :right; the base
    // rule carries only size and margin.
    return {
      name,
      raw,
      baseHeader: undefined,
      baseFooter: undefined,
      hasFirstSuppression,
      hasVersoRecto: true,
      leftHeader: sideBoxes(restHeaders, "left-page"),
      leftFooter: sideBoxes(restFooters, "left-page"),
      rightHeader: sideBoxes(restHeaders, "right-page"),
      rightFooter: sideBoxes(restFooters, "right-page")
    };
  }

  // Uniform (non-verso/recto). Headers/footers go on the base rule. When
  // first-page suppression is on, restHeaders/restFooters carry the values.
  return {
    name,
    raw,
    baseHeader: isMarginBoxes(restHeaders) ? restHeaders : uniformBoxes(raw.headers),
    baseFooter: isMarginBoxes(restFooters) ? restFooters : uniformBoxes(raw.footers),
    hasFirstSuppression,
    hasVersoRecto: false,
    leftHeader: undefined,
    leftFooter: undefined,
    rightHeader: undefined,
    rightFooter: undefined
  };
}

function emitMarginBoxes(boxes: MarginBoxes, position: "top" | "bottom"): string[] {
  const out: string[] = [];
  if (boxes.left) out.push(`  @${position}-left { content: ${expandToken(boxes.left)}; }`);
  if (boxes.center) out.push(`  @${position}-center { content: ${expandToken(boxes.center)}; }`);
  if (boxes.right) out.push(`  @${position}-right { content: ${expandToken(boxes.right)}; }`);
  return out;
}

function emitPageRule(
  name: string,
  raw: PageTemplateLike,
  variant: "" | ":first" | ":left" | ":right",
  headerBoxes: MarginBoxes | undefined,
  footerBoxes: MarginBoxes | undefined,
  includeSizeAndMargin: boolean
): string {
  const lines: string[] = [];
  lines.push(`@page ${name}${variant} {`);
  if (includeSizeAndMargin) {
    lines.push(`  size: ${formatSize(raw.size)};`);
    lines.push(`  margin: ${formatMargin(raw.margin)};`);
  }
  if (headerBoxes) lines.push(...emitMarginBoxes(headerBoxes, "top"));
  if (footerBoxes) lines.push(...emitMarginBoxes(footerBoxes, "bottom"));
  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Emit all CSS rules for a single resolved page template. No branching — we
 * walk the resolved shape and emit the rules it implies.
 */
function emitTemplateRules(t: ResolvedPageTemplate): string[] {
  const out: string[] = [];

  if (t.hasFirstSuppression) {
    // First page: no header/footer boxes; size + margin still apply.
    out.push(emitPageRule(t.name, t.raw, ":first", undefined, undefined, true));
  }

  if (t.hasVersoRecto) {
    // Base rule carries size + margin only; per-side rules carry the boxes.
    out.push(emitPageRule(t.name, t.raw, "", undefined, undefined, true));
    out.push(emitPageRule(t.name, t.raw, ":left", t.leftHeader, t.leftFooter, false));
    out.push(emitPageRule(t.name, t.raw, ":right", t.rightHeader, t.rightFooter, false));
  } else {
    // Single base rule with size, margin, and any uniform boxes.
    out.push(emitPageRule(t.name, t.raw, "", t.baseHeader, t.baseFooter, true));
  }

  return out;
}

function emitTokensRoot(tokens: ProjectConfig["design-tokens"]): string {
  if (!tokens) return "";
  const lines: string[] = [];
  for (const [category, group] of Object.entries(tokens)) {
    if (!group) continue;
    for (const [name, value] of Object.entries(group)) {
      lines.push(`  --${category}-${name}: ${value};`);
    }
  }
  if (lines.length === 0) return "";
  return [":root {", ...lines, "}"].join("\n");
}

export function generateProjectCss(config: ProjectConfig, opts: ProjectCssOptions = {}): string {
  const parts: string[] = [];

  const tokensRoot = emitTokensRoot(config["design-tokens"]);
  if (tokensRoot) parts.push(tokensRoot);

  const fonts = config.fonts ?? [];
  for (const font of fonts) {
    const lines: string[] = [`@font-face {`];
    lines.push(`  font-family: '${font.family}';`);
    lines.push(`  src: url('assets/fonts/${font.file}') format('woff2');`);
    if (font.weight !== undefined) lines.push(`  font-weight: ${font.weight};`);
    if (font.style) lines.push(`  font-style: ${font.style};`);
    lines.push(`}`);
    parts.push(lines.join("\n"));
  }

  for (const [name, tplRaw] of Object.entries(config["page-templates"])) {
    if (!tplRaw) continue;
    const resolved = resolvePageTemplate(name, tplRaw as PageTemplateLike);
    parts.push(...emitTemplateRules(resolved));
  }

  // string-set rules so {chapter}/{section} tokens populate from headings
  parts.push(`h1 { string-set: chapter content(text); }`);
  parts.push(`h2 { string-set: section content(text); }`);

  if (opts.docTitle) {
    parts.push(`body { string-set: title "${opts.docTitle.replace(/"/g, '\\"')}"; }`);
  }

  const typo = config.typography;
  if (typo) {
    const bodyRules: string[] = [];
    const h = typo.hyphenation;
    if (h && h.enabled !== false) {
      bodyRules.push("hyphens: auto");
      const minWord = h["min-word-length"] ?? 5;
      const before = h["min-chars-before"] ?? 2;
      const after = h["min-chars-after"] ?? 2;
      bodyRules.push(`hyphenate-limit-chars: ${minWord} ${before} ${after}`);
      if (h["max-consecutive-hyphens"]) {
        bodyRules.push(`hyphenate-limit-lines: ${h["max-consecutive-hyphens"]}`);
      }
    }
    if (typo.orphans) bodyRules.push(`orphans: ${typo.orphans}`);
    if (typo.widows) bodyRules.push(`widows: ${typo.widows}`);
    if (bodyRules.length > 0) {
      parts.push(`body { ${bodyRules.join("; ")}; }`);
    }
  }

  // .page → @page name mapping
  parts.push(`.page { page: default; }`);
  for (const name of Object.keys(config["page-templates"])) {
    if (name !== "default") {
      parts.push(`.page[data-page-template="${name}"] { page: ${name}; }`);
    }
  }

  // Each .page starts on a new physical page (except the first).
  parts.push(`.page { break-before: page; }`);
  parts.push(`.page:first-child { break-before: avoid; }`);

  // Paged.js extracts @page size/margin into --pagedjs-pagebox-* and
  // --pagedjs-margin-* per named page, but NOT into --pagedjs-width /
  // --pagedjs-height (the visible .pagedjs_page sheet dimensions). Without
  // this, the white sheet stays at letter defaults while the inner pagebox
  // is correctly A4-sized — content overhangs the visible sheet.
  // Override the sheet dimensions explicitly per template.
  for (const [name, tplRaw] of Object.entries(config["page-templates"])) {
    if (!tplRaw) continue;
    const t = tplRaw as PageTemplateLike;
    const [w, h] = sizeToWidthHeight(t.size);
    parts.push(
      `.pagedjs_page.pagedjs_named_page.pagedjs_${name}_page { ` +
        `--pagedjs-width: ${w}; --pagedjs-height: ${h}; ` +
        `--pagedjs-width-right: ${w}; --pagedjs-height-right: ${h}; ` +
        `--pagedjs-width-left: ${w}; --pagedjs-height-left: ${h}; ` +
      `}`
    );
  }

  return parts.join("\n") + "\n";
}

const NAMED_PAGE_SIZES: Record<string, [string, string]> = {
  A4: ["210mm", "297mm"],
  A5: ["148mm", "210mm"],
  A6: ["105mm", "148mm"],
  Letter: ["8.5in", "11in"],
  Legal: ["8.5in", "14in"]
};

function sizeToWidthHeight(size: string | [string, string]): [string, string] {
  if (Array.isArray(size)) return size;
  const named = NAMED_PAGE_SIZES[size];
  if (named) return named;
  // Unknown name — pass through as both dimensions; Paged.js will fall back.
  return [size, size];
}

function formatSize(size: string | [string, string]): string {
  return Array.isArray(size) ? `${size[0]} ${size[1]}` : size;
}

function formatMargin(margin: unknown): string {
  if (margin === 0) return "0";
  const m = margin as Record<string, string | undefined>;
  const top = m.top ?? "0";
  const bottom = m.bottom ?? "0";
  const inner = m.inner ?? m.left ?? "0";
  const outer = m.outer ?? m.right ?? "0";
  return `${top} ${outer} ${bottom} ${inner}`;
}
