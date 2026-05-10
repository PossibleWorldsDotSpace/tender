import { magenta, dim, colorEnabled } from "./style.js";

/**
 * The wordmark — figlet "ANSI Regular" font. Uses U+2588 FULL BLOCK (`█`),
 * which is widely supported in modern terminals (any UTF-8 PTY, SSH,
 * tmux, GitHub Actions logs). It's not strictly 7-bit ASCII — but Tender
 * docs already assume UTF-8, and the alternative (figlet "Standard" with
 * backslash drawing) renders worse and is hard to embed in source.
 */
// figlet "ANSI Regular" font. The ▓-style block characters are upper Latin-1
// box-drawing — well-supported in modern terminals and our docs already
// assume UTF-8. No backslashes/backticks to escape, so a plain template is
// fine here.
const WORDMARK = `
████████ ███████ ███    ██ ██████  ███████ ██████
   ██    ██      ████   ██ ██   ██ ██      ██   ██
   ██    █████   ██ ██  ██ ██   ██ █████   ██████
   ██    ██      ██  ██ ██ ██   ██ ██      ██   ██
   ██    ███████ ██   ████ ██████  ███████ ██   ██
`;

export interface BannerOptions {
  /** Tagline shown beneath the wordmark. Defaults to the package description. */
  tagline?: string;
}

/**
 * Render the banner as a string. Caller decides where to write it; this
 * lets the banner appear in `--help` (stdout) and at `tender preview`
 * startup (stdout) without coupling to either stream.
 *
 * Returns "" when color is disabled AND we're piped to a non-TTY — in
 * that case the wordmark is just visual noise. We keep the banner for
 * `--help` regardless because users explicitly asked for help.
 */
export function renderBanner(opts: BannerOptions = {}): string {
  const lines = WORDMARK.split("\n");
  const tagline = opts.tagline ?? "print-layout for text documents";
  const colored = lines.map(l => magenta(l)).join("\n");
  return `${colored}${dim(`            ${tagline}`)}\n`;
}

/**
 * The "show banner?" decision for non-help output paths (preview startup,
 * init success). Help output always shows it. The rule:
 *   - Show on TTY with color.
 *   - Skip on non-TTY (CI logs, pipes) — the wordmark is decoration.
 *   - Skip when the user has set NO_COLOR — they're signalling "no flair."
 */
export function shouldShowBanner(): boolean {
  return colorEnabled && process.stdout.isTTY === true;
}
