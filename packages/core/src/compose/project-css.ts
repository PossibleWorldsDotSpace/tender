import type { ProjectConfig } from "../config/schema.js";

export function generateProjectCss(config: ProjectConfig): string {
  const parts: string[] = [];
  for (const [name, tpl] of Object.entries(config["page-templates"])) {
    if (!tpl) continue;
    parts.push(`@page ${name} {`);
    parts.push(`  size: ${formatSize(tpl.size)};`);
    parts.push(`  margin: ${formatMargin(tpl.margin)};`);
    parts.push(`}`);
  }
  parts.push(`.page { page: default; }`);
  for (const name of Object.keys(config["page-templates"])) {
    if (name !== "default") {
      parts.push(`.page[data-page-template="${name}"] { page: ${name}; }`);
    }
  }
  return parts.join("\n") + "\n";
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
