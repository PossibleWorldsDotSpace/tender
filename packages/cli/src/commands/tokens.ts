import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as readline from "node:readline";
import { parseDocument } from "yaml";
import { loadProjectConfig } from "@tender/core";
import { bold, cyan, dim, red } from "../ui/style.js";

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

interface Entry {
  category: string;
  name: string;
  path: string;
  currentValue: string;
}

/**
 * Minimal interactive picker for design tokens. Renders a list, lets you
 * navigate with arrow keys, edit a value with Enter, batch unsaved edits in
 * a dirty map, save with `s`, quit with `q` (prompts to save if dirty).
 *
 * No external TUI deps. Pure node `readline` keypress events. Clears the
 * screen on every render — fine for ~dozens of tokens.
 *
 * Reliability: `setRawMode(false)` is called on every exit path. A stuck
 * raw terminal is the worst possible bug here.
 */
export async function editTokens(projectDir: string): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `${red("error")}: \`tender tokens edit\` requires an interactive terminal.\n` +
        `Use \`tender tokens set <token> <value>\` for non-interactive use.\n`
    );
    process.exit(1);
  }

  const tokens = await listTokens(projectDir);
  const entries: Entry[] = [];
  for (const [category, group] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(group)) {
      entries.push({
        category,
        name,
        path: `${category}.${name}`,
        currentValue: String(value)
      });
    }
  }

  if (entries.length === 0) {
    process.stdout.write("No design tokens defined.\n");
    return;
  }

  const longestPath = Math.max(...entries.map((e) => e.path.length));

  // State (closure-local)
  let cursor = 0;
  let editing = false;
  let buffer = "";
  const dirty = new Map<string, string>();
  let status = "";
  // Special prompt mode: when quitting with unsaved edits, ask y/n.
  let savePrompt = false;

  const valueFor = (e: Entry): string => dirty.get(e.path) ?? e.currentValue;

  const render = (): void => {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(
      bold("Tokens") +
        dim(" — ↑/↓ navigate, Enter to edit, s to save, q to quit") +
        "\n\n"
    );
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const isCursor = i === cursor;
      const marker = isCursor ? cyan(">") : " ";
      const path = e.path.padEnd(longestPath);
      const v = valueFor(e);
      const dirtyMark = dirty.has(e.path) ? cyan("*") : " ";
      const pathStr = isCursor ? cyan(path) : path;
      process.stdout.write(`${marker} ${pathStr}  ${v} ${dirtyMark}\n`);
    }
    if (editing) {
      const e = entries[cursor]!;
      process.stdout.write(`\n${cyan(">")} ${e.path}: ${buffer}_\n`);
    } else if (savePrompt) {
      process.stdout.write(
        `\n${cyan("?")} ${dirty.size} unsaved edit${dirty.size === 1 ? "" : "s"}. Save before quitting? [y/n]\n`
      );
    } else {
      const footer =
        status ||
        (dirty.size > 0
          ? dim(`${dirty.size} unsaved edit${dirty.size === 1 ? "" : "s"} — \`s\` to save`)
          : "");
      if (footer) process.stdout.write(`\n${footer}\n`);
    }
  };

  return new Promise<void>((resolveOuter) => {
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      process.stdin.removeListener("keypress", onKey);
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onKey = (str: string | undefined, key: readline.Key): void => {
      // Ctrl-C is always a hard exit, regardless of mode.
      if (key && key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      if (savePrompt) {
        if (str === "y" || str === "Y") {
          savePrompt = false;
          status = "Saving...";
          render();
          (async () => {
            try {
              for (const [path, value] of dirty) {
                await setToken(projectDir, path, value);
              }
              dirty.clear();
              cleanup();
              resolveOuter();
            } catch (err) {
              status = red(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
              render();
            }
          })();
          return;
        }
        if (str === "n" || str === "N") {
          dirty.clear();
          cleanup();
          resolveOuter();
          return;
        }
        if (key && key.name === "escape") {
          savePrompt = false;
          render();
          return;
        }
        return;
      }

      if (editing) {
        if (key && key.name === "return") {
          const e = entries[cursor]!;
          if (buffer === e.currentValue) {
            dirty.delete(e.path);
          } else {
            dirty.set(e.path, buffer);
          }
          editing = false;
          buffer = "";
          status = "";
          render();
          return;
        }
        if (key && key.name === "escape") {
          editing = false;
          buffer = "";
          status = dim("Edit cancelled.");
          render();
          return;
        }
        if (key && key.name === "backspace") {
          buffer = buffer.slice(0, -1);
          render();
          return;
        }
        // Printable char: arrow keys etc. have no `str` or have escape sequences.
        if (str && !key.ctrl && !key.meta && str.length === 1 && str >= " " && str !== "\x7f") {
          buffer += str;
          render();
          return;
        }
        return;
      }

      // Navigation mode.
      if (key && key.name === "up") {
        cursor = Math.max(0, cursor - 1);
        status = "";
        render();
        return;
      }
      if (key && key.name === "down") {
        cursor = Math.min(entries.length - 1, cursor + 1);
        status = "";
        render();
        return;
      }
      if (key && key.name === "return") {
        editing = true;
        buffer = valueFor(entries[cursor]!);
        status = "";
        render();
        return;
      }
      if (str === "s") {
        if (dirty.size === 0) {
          status = dim("Nothing to save.");
          render();
          return;
        }
        status = "Saving...";
        render();
        (async () => {
          try {
            const n = dirty.size;
            for (const [path, value] of dirty) {
              const result = await setToken(projectDir, path, value);
              // Update in-memory currentValue so quitting after save shows clean.
              const entry = entries.find((e) => e.path === path);
              if (entry) entry.currentValue = result.next;
            }
            dirty.clear();
            status = dim(`Saved ${n} edit${n === 1 ? "" : "s"}.`);
            render();
          } catch (err) {
            status = red(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
            render();
          }
        })();
        return;
      }
      if (str === "q") {
        if (dirty.size > 0) {
          savePrompt = true;
          render();
          return;
        }
        cleanup();
        resolveOuter();
        return;
      }
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
    render();
  });
}
