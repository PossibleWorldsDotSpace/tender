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

export const ProjectConfig = z.object({
  "page-templates": z.record(z.string(), PageTemplate)
    .refine(t => "default" in t, { message: "page-templates.default is required" })
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
