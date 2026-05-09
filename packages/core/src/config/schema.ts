import { z } from "zod";

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

export const Component = z.object({
  tag: z.string(),
  class: z.string().optional(),
  attrs: z.array(z.string()).optional(),
  inline: z.boolean().optional(),
  palette: Palette.optional()
});

export const Template = z.object({
  params: z.array(z.string()).optional(),
  slots: z.array(z.string()).optional(),
  template: z.string(),
  palette: Palette.optional()
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

export const ProjectConfig = z.object({
  "page-templates": z.record(z.string(), PageTemplate)
    .refine(t => "default" in t, { message: "page-templates.default is required" }),
  components: z.record(z.string(), Component).optional(),
  templates: z.record(z.string(), Template).optional(),
  typography: Typography.optional(),
  fonts: z.array(Font).optional(),
  render: Render.optional()
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
