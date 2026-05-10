import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { loadProjectConfig } from "@tender/core";
import { cyan, dim } from "../ui/style.js";

type Tokens = Record<string, Record<string, string | number>>;

export async function listTokens(projectDir: string): Promise<Tokens> {
  const config = await loadProjectConfig(projectDir);
  return (config["design-tokens"] ?? {}) as Tokens;
}

/** Truecolor swatch for a hex color. Returns empty string when not a 6-digit hex. */
function swatch(value: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!m) return "";
  const hex = m[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // OSC truecolor — degrades to nothing visible on non-truecolor terms.
  // The hex value itself is also printed alongside, so authors always see the value.
  return `\x1b[38;2;${r};${g};${b}m■\x1b[39m`;
}

export function formatTokensList(tokens: Tokens): string {
  const categories = Object.entries(tokens);
  if (categories.length === 0) return "No design tokens defined.";
  const lines: string[] = [];
  let totalTokens = 0;
  for (const [category, group] of categories) {
    lines.push(cyan(category));
    const entries = Object.entries(group);
    const longest = Math.max(...entries.map(([n]) => n.length));
    for (const [name, value] of entries) {
      totalTokens++;
      const padded = name.padEnd(longest);
      const v = String(value);
      const sw = category === "color" ? `  ${swatch(v)}` : "";
      lines.push(`  ${padded}  ${v}${sw}`);
    }
    lines.push("");
  }
  lines.push(dim(`${categories.length} categories, ${totalTokens} tokens.`));
  return lines.join("\n");
}

export interface SetTokenResult {
  previous: string | undefined;
  next: string;
  created: boolean;
}

export async function setToken(
  projectDir: string,
  tokenPath: string,
  value: string
): Promise<SetTokenResult> {
  const m = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(tokenPath);
  if (!m) throw new Error(`Token path must be \`category.name\` (got: ${tokenPath})`);
  const category = m[1]!;
  const name = m[2]!;
  const path = join(projectDir, "project.yaml");
  const src = await readFile(path, "utf8");
  const doc = parseDocument(src);

  const previous = doc.getIn(["design-tokens", category, name]);
  doc.setIn(["design-tokens", category, name], value);

  await writeFile(path, doc.toString());
  return {
    previous: previous === undefined || previous === null ? undefined : String(previous),
    next: value,
    created: previous === undefined || previous === null
  };
}
