import { z } from "zod";

/**
 * Allowlist of inline-shortcut characters (item 6). Single characters that
 * don't collide with CommonMark inline syntax (`*`, `_`, `` ` ``, `~`, etc.)
 * and don't carry strong prose-punctuation expectations:
 *
 *   `@`  rare in prose; common as @handle marker but Markdown doesn't claim it.
 *   `%`  rare in prose.
 *   `|`  CommonMark only uses `|` inside table extensions.
 *   `§`  non-ASCII section symbol; unambiguous.
 *
 * `^` is excluded because pandoc-style superscript (`^x^`) is widely
 * supported. Other punctuation (`?`, `!`, `:`, `;`, `/`, `$`) is excluded
 * because of strong prose or URL-like collision risks.
 */
export const SHORTCUT_ALLOWLIST = new Set(["@", "%", "|", "§"]);

const Length = z.string().regex(/^-?\d+(\.\d+)?(mm|cm|in|pt|px)$/);
const PageSize = z.union([
  z.enum(["A4", "A5", "A6", "Letter", "Legal"]),
  z.tuple([Length, Length])
]);
const Margin = z.object({
  top: Length.optional(),
  bottom: Length.optional(),
  inner: Length.optional(),
  outer: Length.optional(),
  left: Length.optional(),
  right: Length.optional()
}).or(z.literal(0));

const MarginBoxes = z.object({
  left: z.string().optional(),
  center: z.string().optional(),
  right: z.string().optional()
});

const VersoRecto = z.object({
  "left-page": MarginBoxes.optional(),
  "right-page": MarginBoxes.optional()
});

const HeaderFooterConfig = z.union([z.literal("none"), MarginBoxes, VersoRecto]);
const HeaderFooterRest = z.union([MarginBoxes, VersoRecto]);

export const PageTemplate = z.object({
  size: PageSize,
  margin: Margin,
  bleed: Length.optional(),
  headers: HeaderFooterConfig.optional(),
  footers: HeaderFooterConfig.optional(),
  "headers-rest": HeaderFooterRest.optional(),
  "footers-rest": HeaderFooterRest.optional()
});

const PaletteVariant = z.object({
  attrs: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional()
});

export const Palette = z.object({
  attrs: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional(),
  variants: z.array(PaletteVariant).optional()
});

/**
 * A component is a layout element. Two flavors, distinguished by whether
 * `template` is present:
 *
 * - **Wrapper** (no `template`): a fixed HTML wrapper. Declares `tag`, optional
 *   `class`, optional `params` (forwarded as `data-NAME` attributes), and
 *   optional `inline`.
 * - **Block template** (has `template`): a Handlebars template. The `template`
 *   string sees `{{{body}}}`, declared `{{params}}`, and named `{{{slots}}}`
 *   when `slots` is set.
 *
 * The two are mutually exclusive at the field level: a `tag` is the wrapper's
 * shorthand, and a `template` is the block-template's full body.
 */
export const Component = z.object({
  // Wrapper-only:
  tag: z.string().optional(),
  class: z.string().optional(),
  // Common:
  params: z.array(z.string()).optional(),
  slots: z.array(z.string()).optional(),
  inline: z.boolean().optional(),
  // Template-only:
  template: z.string().optional(),
  palette: Palette.optional()
})
.refine(c => c.tag !== undefined || c.template !== undefined, {
  message: "component must declare either `tag` (wrapper) or `template` (Handlebars body)"
})
.refine(c => !(c.tag !== undefined && c.template !== undefined), {
  message: "component cannot declare both `tag` and `template`"
})
.refine(c => !(c.template === undefined && c.slots !== undefined), {
  message: "wrapper components (no `template`) cannot declare `slots`"
});

const Hyphenation = z.object({
  enabled: z.boolean().optional(),
  "min-word-length": z.number().int().positive().optional(),
  "min-chars-before": z.number().int().positive().optional(),
  "min-chars-after": z.number().int().positive().optional(),
  "max-consecutive-hyphens": z.number().int().positive().optional()
});

export const Typography = z.object({
  lang: z.string().optional(),
  hyphenation: Hyphenation.optional(),
  orphans: z.number().int().positive().optional(),
  widows: z.number().int().positive().optional()
});

export const Font = z.object({
  family: z.string(),
  file: z.string(),
  weight: z.union([z.number(), z.string()]).optional(),
  style: z.enum(["normal", "italic", "oblique"]).optional()
});

export const Render = z.object({
  // Maximum time (ms) to wait for Paged.js pagination. Defaults to 60000 in
  // the renderer; long documents on slow hardware may legitimately need more.
  "timeout-ms": z.number().int().positive().optional()
});

/**
 * Configuration for `tender clean`. Only one field for v1; the schema's
 * object shape is forward-compatible with future fields like
 * preserve-trailing-double-space, dash-style, quote-direction.
 */
export const Clean = z.object({
  /** Enable rule 8 (smart-typography). Default: off. */
  typography: z.enum(["off", "smart"]).optional()
});

const TokenIdent = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message: "must be lowercase, hyphenated (matching /^[a-z][a-z0-9-]*$/)"
});

const TokenValue = z.union([z.string(), z.number()]);

const TokenGroup = z.record(TokenIdent, TokenValue);

const DesignTokens = z.record(TokenIdent, TokenGroup);

export const ProjectConfig = z.object({
  "page-templates": z.record(z.string(), PageTemplate)
    .refine(t => "default" in t, { message: "page-templates.default is required" }),
  components: z.record(z.string(), Component).optional(),
  /**
   * Single-character marks (e.g. `@speaker@`) that expand to inline
   * components. The character must be in SHORTCUT_ALLOWLIST; the mapped
   * component name is validated at registry-load time (must exist; must be
   * inline:true).
   */
  "inline-shortcuts": z.record(
    z.string().refine(
      c => c.length === 1 && SHORTCUT_ALLOWLIST.has(c),
      { message: "inline-shortcut character must be one of: @ % | §" }
    ),
    z.string()
  ).optional(),
  typography: Typography.optional(),
  /** `tender clean` settings (item 9). */
  clean: Clean.optional(),
  fonts: z.array(Font).optional(),
  render: Render.optional(),
  "design-tokens": DesignTokens.optional()
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
