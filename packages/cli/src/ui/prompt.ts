import { bold } from "./style.js";
import * as readline from "node:readline";

/**
 * Tiny yes/no prompt. No `inquirer`/`prompts` dependency — Tender ships
 * zero runtime polish libraries on principle (see issue #6).
 *
 * Uses `readline.createInterface` rather than `process.stdin.once("data")`
 * so the prompt reads a complete line (terminated by Enter) rather than
 * whatever bytes happen to be in the stream when the listener fires. This
 * matters when a configurator TUI just ran and left raw-mode artifacts in
 * stdin (e.g. a buffered escape sequence): a naive `once("data")` would
 * read those stray bytes as the user's answer, return false, and silently
 * skip the prompt. `readline` waits for `\n` like the user expects.
 *
 * Only meaningful on an interactive terminal. Callers decide non-interactive
 * behaviour themselves (via flags / documented defaults) and should not call
 * this when `process.stdin.isTTY` is false — there's no one to answer.
 *
 * `defaultYes` controls both the rendered hint (`[Y/n]` vs `[y/N]`) and the
 * answer when the user just presses Enter.
 */
export async function confirm(
  question: string,
  defaultYes: boolean,
  read: () => Promise<string> = readLineFromStdin
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  process.stdout.write(`${bold(question)} ${hint} `);
  const answer = (await read()).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return /^y(es)?$/.test(answer);
}

function readLineFromStdin(): Promise<string> {
  return new Promise<string>(res => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.once("line", line => {
      rl.close();
      res(line);
    });
  });
}
