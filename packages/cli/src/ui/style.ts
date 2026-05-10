/**
 * Tiny ANSI helper. No `chalk` dependency — Tender ships zero runtime polish
 * libraries on principle (see issue #6). Detects whether color is welcome
 * and exposes color functions that no-op when it isn't.
 *
 * Color is enabled when **all** of these hold:
 *   - stdout is a TTY
 *   - `NO_COLOR` is unset                    (https://no-color.org/)
 *   - `CI` is unset or "false"
 *   - `TERM` is not "dumb"
 *
 * The `color` boolean is decided once at module load. That's intentional: a
 * single CLI invocation either has color or it doesn't — we don't want to
 * re-check per call. Tests can spawn child processes with their own env.
 */

const env = process.env;

export const colorEnabled: boolean = (() => {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.CI && env.CI !== "false" && env.CI !== "0") return false;
  if (env.TERM === "dumb") return false;
  if (env.FORCE_COLOR === "1" || env.FORCE_COLOR === "true") return true;
  return process.stdout.isTTY === true;
})();

function wrap(open: number, close: number) {
  const o = `\x1b[${open}m`;
  const c = `\x1b[${close}m`;
  return (s: string): string => (colorEnabled ? `${o}${s}${c}` : s);
}

export const red = wrap(31, 39);
export const yellow = wrap(33, 39);
export const green = wrap(32, 39);
export const cyan = wrap(36, 39);
export const magenta = wrap(35, 39);
export const dim = wrap(2, 22);
export const bold = wrap(1, 22);

/** Strip ANSI escapes from a string. Useful for tests / `--json` paths. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
