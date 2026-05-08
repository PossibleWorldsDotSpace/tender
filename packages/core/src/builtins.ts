/**
 * Built-in templates that are always available without explicit declaration.
 * User templates with the same name override these.
 */
export const BUILTIN_TEMPLATES: Record<
  string,
  { params?: readonly string[]; slots?: readonly string[]; template: string }
> = {
  page: {
    params: ["template"],
    template: `<div class="page"{{#if template}} data-page-template="{{template}}"{{/if}}>{{{body}}}</div>`
  }
};
