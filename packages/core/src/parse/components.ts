import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import type { ProjectConfig } from "../config/schema.js";

interface DirectiveLike {
  type: string;
  name: string;
  attributes?: Record<string, string | null | undefined>;
  data?: Record<string, unknown>;
}

export const resolveComponents: Plugin<[ProjectConfig], Root> = (config) => (tree) => {
  const components = config.components ?? {};
  const templates = config.templates ?? {};
  visit(tree, (node) => {
    if (
      node.type !== "containerDirective" &&
      node.type !== "leafDirective" &&
      node.type !== "textDirective"
    ) return;
    const dir = node as unknown as DirectiveLike;
    // Skip directives that match a template — they'll be handled elsewhere later.
    if (dir.name in templates) return;
    const def = components[dir.name];
    if (!def) {
      throw new Error(`Unknown component "${dir.name}"`);
    }
    if (def.inline && dir.type === "containerDirective") {
      throw new Error(`Component "${dir.name}" is inline-only; cannot use as a block`);
    }
    const data = (dir.data ??= {});
    data.hName = def.tag;
    const props: Record<string, string> = {};
    if (def.class) props.className = def.class;
    if (def.attrs && dir.attributes) {
      for (const k of def.attrs) {
        const v = dir.attributes[k];
        if (v != null) props[`data-${k}`] = v;
      }
    }
    data.hProperties = props;
  });
};
