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

export const PageTemplate = z.object({
  size: PageSize,
  margin: Margin,
  bleed: Length.optional()
});

export const Component = z.object({
  tag: z.string(),
  class: z.string().optional(),
  attrs: z.array(z.string()).optional(),
  inline: z.boolean().optional()
});

export const Template = z.object({
  params: z.array(z.string()).optional(),
  slots: z.array(z.string()).optional(),
  template: z.string()
});

export const ProjectConfig = z.object({
  "page-templates": z.record(z.string(), PageTemplate)
    .refine(t => "default" in t, { message: "page-templates.default is required" }),
  components: z.record(z.string(), Component).optional(),
  templates: z.record(z.string(), Template).optional()
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
