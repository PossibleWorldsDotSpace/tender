/**
 * Thin TTY driver for the token picker. Same shape as
 * page-setup-driver.ts: all interaction logic is in the pure reducer
 * (token-picker.ts); this only wires real keypress → reduce → render,
 * computes the mandatory pre-write diff via the slice-1 engine, and writes
 * project.yaml on apply. Raw-mode cleanup on EVERY exit path.
 */

import * as readline from "node:readline";
import { loadProjectConfig } from "@tender/core";
import {
  initTokenPicker, reduce, render, collectEdits,
  type TokenPickerState, type KeyEvent
} from "./token-picker.js";
import {
  readProjectDocument, parseProjectDocument, applyEdits,
  serializeDocument, diffYaml, writeProjectDocument
} from "./document.js";
import { ansiTheme, copy } from "./theme.js";

export interface TokenPickerIO {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WritableStream;
  isTTY?: boolean;
}

/** One newly-added design token, surfaced so the end-of-init roundup can
 * list it by name/value rather than just a count. */
export interface AddedTokenSummary {
  category: string;
  name: string;
  /** The value as it will appear in YAML (normalised hex for colours,
   * stringified numbers, etc). */
  value: string;
}

export interface TokenPickerResult {
  outcome: "applied" | "no-op" | "cancelled";
  editCount: number;
  /** New tokens added this session (i.e. category.name pairs that didn't
   * exist in project.yaml when the screen opened). Empty for no-op /
   * cancelled, or when the only changes were edits to existing tokens. */
  addedTokens: AddedTokenSummary[];
}

function toKeyEvent(str: string | undefined, key: readline.Key): KeyEvent {
  return { str, name: key?.name };
}

/**
 * Run the token picker against a project directory. Rejects if not a TTY —
 * callers gate on isTTY and fall back to `tender tokens set` / editing
 * project.yaml directly.
 */
export async function runTokenPicker(
  projectDir: string,
  io: TokenPickerIO = {}
): Promise<TokenPickerResult> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const isTTY = io.isTTY ?? input.isTTY === true;

  if (!isTTY) {
    throw new Error(copy.needsTTY(copy.tokens.title));
  }

  const config = await loadProjectConfig(projectDir);
  let state = initTokenPicker(config);
  const { src } = await readProjectDocument(projectDir);

  const write = (s: string): void => { output.write(s); };
  const clear = (): void => { output.write("\x1b[2J\x1b[H"); };

  let diffText = "";

  // One renderer owns the whole screen; the driver supplies the diff.
  const paint = (): void => {
    clear();
    write(render(state, ansiTheme, diffText));
    write("\n");
  };

  const computeDiff = (): void => {
    const edits = collectEdits(state);
    if (edits.length === 0) { diffText = ""; return; }
    const doc = parseProjectDocument(src);
    applyEdits(doc, edits, "merge");
    diffText = diffYaml(src, serializeDocument(doc));
  };

  return await new Promise<TokenPickerResult>((resolve, reject) => {
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      input.removeListener("keypress", onKey);
      try { if (isTTY && input.setRawMode) input.setRawMode(false); } catch { /* ignore */ }
      input.pause();
      write("\n");
    };

    const finish = (result: TokenPickerResult): void => {
      cleanup();
      resolve(result);
    };

    const onKey = (str: string | undefined, key: readline.Key): void => {
      try {
        if (key && key.ctrl && key.name === "c") {
          cleanup();
          process.exit(130);
        }

        const wasConfirm = state.phase === "confirm";
        state = reduce(state, toKeyEvent(str, key));

        if (state.phase === "confirm" && !wasConfirm) computeDiff();

        if (state.phase === "cancelled") {
          finish({ outcome: "cancelled", editCount: 0, addedTokens: [] });
          return;
        }
        if (state.phase === "done") {
          const edits = collectEdits(state);
          if (edits.length === 0) {
            finish({ outcome: "no-op", editCount: 0, addedTokens: [] });
            return;
          }
          // Capture newly-added tokens from the post-edit state — `added`
          // is flagged on the row when reduceAdd commits a new category.name.
          // Pure edits to existing tokens don't show up in this list.
          const addedTokens = state.rows
            .filter(r => r.added)
            .map(r => ({ category: r.category, name: r.name, value: r.value }));
          (async () => {
            try {
              const doc = parseProjectDocument(src);
              const n = applyEdits(doc, edits, "merge");
              await writeProjectDocument(projectDir, doc);
              finish({ outcome: "applied", editCount: n, addedTokens });
            } catch (err) {
              cleanup();
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          })();
          return;
        }

        paint();
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    readline.emitKeypressEvents(input);
    try { if (input.setRawMode) input.setRawMode(true); } catch { /* ignore */ }
    input.resume();
    input.on("keypress", onKey);
    paint();
  });
}
