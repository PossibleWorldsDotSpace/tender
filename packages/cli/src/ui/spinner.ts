import { colorEnabled, dim, green, red } from "./style.js";

/**
 * Hand-rolled tiny spinner. No `ora` dependency. Renders to stderr so it
 * doesn't pollute pipelines that capture stdout (e.g. `tender lint --json`).
 *
 * No-ops when stderr isn't a TTY — under CI / pipes / `--json` consumers,
 * the spinner stays silent and `succeed()`/`fail()` print a single line.
 *
 * The frames are pure ASCII (issue #6: "no Unicode trickery — terminals
 * vary"). The classic spinner-of-slashes is short and reliable.
 */

const FRAMES = ["|", "/", "-", "\\"];
const INTERVAL_MS = 80;

export interface Spinner {
  /** Stop, render the success line, return cleanly. */
  succeed: (text?: string) => void;
  /** Stop, render the failure line. Doesn't throw. */
  fail: (text?: string) => void;
  /** Stop and clear the spinner without printing anything. */
  stop: () => void;
  /** Update the active label without restarting. */
  update: (text: string) => void;
}

export function startSpinner(label: string): Spinner {
  const isTTY = process.stderr.isTTY === true;
  // Honor NO_COLOR/CI implicitly via colorEnabled — when color is off, so is
  // animation. Different signal but same intent: "don't be fancy in logs."
  const animate = isTTY && colorEnabled;

  let current = label;
  let frame = 0;
  let timer: NodeJS.Timeout | null = null;

  const render = () => {
    const f = FRAMES[frame % FRAMES.length] ?? "|";
    process.stderr.write(`\r${dim(f)} ${current}`);
    frame++;
  };

  const clear = () => {
    if (animate) {
      // \r + clear-to-end-of-line. Padding fallback for terminals that don't
      // honor the escape (rare, but safer than leaving a half-rendered frame).
      process.stderr.write("\r\x1b[K");
    }
  };

  if (animate) {
    render();
    timer = setInterval(render, INTERVAL_MS);
  }

  return {
    succeed(text?: string) {
      if (timer) clearInterval(timer);
      clear();
      const msg = text ?? current;
      process.stderr.write(`${green("ok")} ${msg}\n`);
    },
    fail(text?: string) {
      if (timer) clearInterval(timer);
      clear();
      const msg = text ?? current;
      process.stderr.write(`${red("FAIL")} ${msg}\n`);
    },
    stop() {
      if (timer) clearInterval(timer);
      clear();
    },
    update(text: string) {
      current = text;
    }
  };
}
