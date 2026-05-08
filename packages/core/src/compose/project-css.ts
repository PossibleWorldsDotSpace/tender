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

function emitMarginBoxes(boxes: MarginBoxes, position: "top" | "bottom"): string[] {
  const out: string[] = [];
  if (boxes.left) out.push(`  @${position}-left { content: ${expandToken(boxes.left)}; }`);
  if (boxes.center) out.push(`  @${position}-center { content: ${expandToken(boxes.center)}; }`);
  if (boxes.right) out.push(`  @${position}-right { content: ${expandToken(boxes.right)}; }`);
  return out;
}

function emitPageRule(
  name: string,
  tpl: PageTemplateLike,
  variant: "" | ":first" | ":left" | ":right",
  headerBoxes: MarginBoxes | undefined,
  footerBoxes: MarginBoxes | undefined,
  includeSizeAndMargin: boolean
): string {
  const lines: string[] = [];
  lines.push(`@page ${name}${variant} {`);
  if (includeSizeAndMargin) {
    lines.push(`  size: ${formatSize(tpl.size)};`);
    lines.push(`  margin: ${formatMargin(tpl.margin)};`);
  }
  if (headerBoxes) lines.push(...emitMarginBoxes(headerBoxes, "top"));
  if (footerBoxes) lines.push(...emitMarginBoxes(footerBoxes, "bottom"));
  lines.push(`}`);
  return lines.join("\n");
}

function uniformBoxes(c: HeaderFooter | undefined): MarginBoxes | undefined {
  if (!c || c === "none") return undefined;
  if (isVersoRecto(c)) return undefined;
  return c;
}

function versoRectoSide(c: HeaderFooter | undefined, side: "left-page" | "right-page"): MarginBoxes | undefined {
  if (!c || c === "none") return undefined;
  if (isVersoRecto(c)) return c[side];
  return c;
}

function restBoxes(c: MarginBoxes | VersoRecto | undefined): MarginBoxes | undefined {
  if (!c) return undefined;
  if (isVersoRecto(c)) return undefined;
  if (isMarginBoxes(c)) return c;
  return undefined;
}

function restVersoRectoSide(
  c: MarginBoxes | VersoRecto | undefined,
  side: "left-page" | "right-page"
): MarginBoxes | undefined {
  if (!c) return undefined;
  if (isVersoRecto(c)) return c[side];
  if (isMarginBoxes(c)) return c;
  return undefined;
}

export function generateProjectCss(config: ProjectConfig, opts: ProjectCssOptions = {}): string {
  const parts: string[] = [];

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
    const t = tplRaw as PageTemplateLike;

    const headersIsVR = isVersoRecto(t.headers);
    const footersIsVR = isVersoRecto(t.footers);
    const restHeadersIsVR = isVersoRecto(t["headers-rest"]);
    const restFootersIsVR = isVersoRecto(t["footers-rest"]);
    const usesVersoRecto = headersIsVR || footersIsVR || restHeadersIsVR || restFootersIsVR;
    const hasFirstVariant =
      (t.headers === "none" && t["headers-rest"] !== undefined) ||
      (t.footers === "none" && t["footers-rest"] !== undefined);

    if (hasFirstVariant) {
      // :first suppresses headers/footers (no boxes); ongoing uses *-rest
      parts.push(emitPageRule(name, t, ":first", undefined, undefined, true));

      const onHeaders: MarginBoxes | VersoRecto | undefined =
        t.headers === "none" ? t["headers-rest"] : (t["headers-rest"] ?? (t.headers as MarginBoxes | VersoRecto | undefined));
      const onFooters: MarginBoxes | VersoRecto | undefined =
        t.footers === "none" ? t["footers-rest"] : (t["footers-rest"] ?? (t.footers as MarginBoxes | VersoRecto | undefined));

      if (usesVersoRecto || isVersoRecto(onHeaders) || isVersoRecto(onFooters)) {
        // base @page name with size/margin; then :left and :right variants with boxes
        parts.push(emitPageRule(name, t, "", undefined, undefined, true));
        parts.push(
          emitPageRule(
            name,
            t,
            ":left",
            isVersoRecto(onHeaders) ? onHeaders["left-page"] : (onHeaders as MarginBoxes | undefined),
            isVersoRecto(onFooters) ? onFooters["left-page"] : (onFooters as MarginBoxes | undefined),
            false
          )
        );
        parts.push(
          emitPageRule(
            name,
            t,
            ":right",
            isVersoRecto(onHeaders) ? onHeaders["right-page"] : (onHeaders as MarginBoxes | undefined),
            isVersoRecto(onFooters) ? onFooters["right-page"] : (onFooters as MarginBoxes | undefined),
            false
          )
        );
        // Re-emit a :first to suppress on first page (already done above; ensure ordering keeps non-first rules generic)
      } else {
        const onHeaderBoxes = isMarginBoxes(onHeaders) ? onHeaders : undefined;
        const onFooterBoxes = isMarginBoxes(onFooters) ? onFooters : undefined;
        parts.push(emitPageRule(name, t, "", onHeaderBoxes, onFooterBoxes, true));
      }
    } else if (usesVersoRecto) {
      parts.push(emitPageRule(name, t, "", undefined, undefined, true));
      parts.push(
        emitPageRule(
          name,
          t,
          ":left",
          versoRectoSide(t.headers, "left-page"),
          versoRectoSide(t.footers, "left-page"),
          false
        )
      );
      parts.push(
        emitPageRule(
          name,
          t,
          ":right",
          versoRectoSide(t.headers, "right-page"),
          versoRectoSide(t.footers, "right-page"),
          false
        )
      );
    } else {
      parts.push(emitPageRule(name, t, "", uniformBoxes(t.headers), uniformBoxes(t.footers), true));
    }
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
