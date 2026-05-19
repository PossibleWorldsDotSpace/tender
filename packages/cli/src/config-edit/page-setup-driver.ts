/**
 * Thin TTY driver for the page-setup screen. All interaction logic lives
 * in the pure reducer (page-setup.ts); this only wires real stdin keypress
 * events → reduce → render, computes the confirm-phase diff via the
 * slice-1 engine, and writes project.yaml on apply.
 *
 * Streams are injectable so the wiring (not just the reducer) is testable
 * without a pseudo-TTY. Raw-mode discipline mirrors `tokens edit`:
 * setRawMode(false) on EVERY exit path — a stuck raw terminal is the worst
 * possible failure here.
 */

import * as readline from "node:readline";
import { loadProjectConfig } from "@tender/core";
import { bold, cyan, dim, red } from "../ui/style.js";
import {
  initPageSetup, reduce, render, collectEdits, invalidCustomDims,
  type PageSetupState, type KeyEvent
} from "./page-setup.js";
import {
  readProjectDocument, parseProjectDocument, applyEdits,
  serializeDocument, diffYaml, writeProjectDocument
} from "./document.js";

export interface PageSetupIO {
  /** Raw-mode-capable input. Defaults to process.stdin. */
  input?: NodeJS.ReadStream;
  /** Output sink. Defaults to process.stdout. */
  output?: NodeJS.WritableStream;
  /** Override the TTY check (tests). Defaults to input.isTTY. */
  isTTY?: boolean;
}

export interface PageSetupResult {
  /** "applied" wrote the file; "no-op" had nothing to change; "cancelled". */
  outcome: "applied" | "no-op" | "cancelled";
  /** Edits applied (empty for no-op/cancelled). */
  editCount: number;
}

/** Map a node readline keypress to the reducer's minimal KeyEvent. */
function toKeyEvent(str: string | undefined, key: readline.Key): KeyEvent {
  return { str: str, name: key?.name };
}

/**
 * Run the page-setup screen against a project directory. Resolves when the
 * user applies, cancels, or the walk was a no-op. Hard-errors (rejects) if
 * not a TTY — a wizard has no non-interactive meaning; callers should gate
 * on isTTY and offer `tender tokens set` / hand-editing instead.
 */
export async function runPageSetup(
  projectDir: string,
  io: PageSetupIO = {}
): Promise<PageSetupResult> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const isTTY = io.isTTY ?? input.isTTY === true;

  if (!isTTY) {
    throw new Error(
      "page setup requires an interactive terminal — " +
        "use `tender tokens set` or edit project.yaml directly"
    );
  }

  const config = await loadProjectConfig(projectDir);
  let state = initPageSetup(config);
  if (state.fields.length === 0) {
    return { outcome: "no-op", editCount: 0 };
  }

  // Pre-read the document once; re-read at apply time would race a
  // concurrent editor, but for a single interactive session this snapshot
  // is what the diff is computed against and what we write back.
  const { src } = await readProjectDocument(projectDir);

  const write = (s: string): void => { output.write(s); };
  const clear = (): void => { output.write("\x1b[2J\x1b[H"); };

  let diffText = "";

  const paint = (): void => {
    clear();
    write(bold("Tender — page setup") + "\n\n");
    write(render(state));
    if (state.phase === "confirm") {
      write("\n\n");
      write(diffText ? diffText : dim("(no changes)"));
      write("\n\n" + cyan("Apply? [y]es  [n]o  [e]dit more"));
    }
    write("\n");
  };

  const computeDiff = (): void => {
    const edits = collectEdits(state);
    if (edits.length === 0) { diffText = ""; return; }
    const doc = parseProjectDocument(src);
    applyEdits(doc, edits, "merge");
    diffText = diffYaml(src, serializeDocument(doc));
  };

  return await new Promise<PageSetupResult>((resolve, reject) => {
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      input.removeListener("keypress", onKey);
      try { if (isTTY && input.setRawMode) input.setRawMode(false); } catch { /* ignore */ }
      input.pause();
      write("\n");
    };

    const finish = (result: PageSetupResult): void => {
      cleanup();
      resolve(result);
    };

    const onKey = (str: string | undefined, key: readline.Key): void => {
      try {
        if (key && key.ctrl && key.name === "c") {
          cleanup();
          // Match tokens edit: Ctrl-C is a hard 130 exit.
          process.exit(130);
        }

        const wasConfirm = state.phase === "confirm";
        const wasEdit = state.phase === "edit";

        // Entering confirm: validate custom dims first; refuse with a
        // status message rather than writing an invalid project.yaml.
        if (wasEdit && key && key.name === "return") {
          const bad = invalidCustomDims(state);
          if (bad.length > 0) {
            state = { ...state, status: red(`invalid: ${bad.join(", ")}`) };
            paint();
            return;
          }
        }

        state = reduce(state, toKeyEvent(str, key));

        if (state.phase === "confirm" && !wasConfirm) computeDiff();

        if (state.phase === "cancelled") {
          finish({ outcome: "cancelled", editCount: 0 });
          return;
        }
        if (state.phase === "done") {
          const edits = collectEdits(state);
          if (edits.length === 0) {
            finish({ outcome: "no-op", editCount: 0 });
            return;
          }
          // Apply and write. Done synchronously-ish via a microtask so the
          // keypress handler stays sync; errors surface via reject.
          (async () => {
            try {
              const doc = parseProjectDocument(src);
              const n = applyEdits(doc, edits, "merge");
              await writeProjectDocument(projectDir, doc);
              finish({ outcome: "applied", editCount: n });
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
