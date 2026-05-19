import { bold } from "./style.js";

/**
 * Tiny yes/no prompt. No `inquirer`/`prompts` dependency — Tender ships
 * zero runtime polish libraries on principle (see issue #6). Same raw
 * `process.stdin.once("data")` pattern the CLI already uses for the
 * initial-commit and `tender clean` prompts.
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
  read: () => Promise<string> = readStdinOnce
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  process.stdout.write(`${bold(question)} ${hint} `);
  const answer = (await read()).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return /^y(es)?$/.test(answer);
}

function readStdinOnce(): Promise<string> {
  return new Promise<string>(res => {
    process.stdin.once("data", chunk => res(chunk.toString()));
  });
}
