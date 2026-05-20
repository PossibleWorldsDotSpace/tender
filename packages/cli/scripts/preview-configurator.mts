/**
 * Visual preview harness for the `tender configure` screens (#17 slice 5).
 *
 * Why this exists: the screens are pure reducer + renderer, so the test
 * suite covers interaction logic without a TTY — but it can't show what the
 * coloured, glyph'd screen actually *looks* like. This drives the real
 * renderers with `ansiTheme` through every visually distinct state so copy
 * and colour can be eyeballed as a system (the explicit slice-5 goal:
 * "felt before fixing the words"). It imports the production renderers, so
 * it can't drift from what ships.
 *
 * Not a test, not bundled, not shipped. Run it by hand:
 *
 *   pnpm --filter @possibleworlds/tender preview:configurator [projectDir]
 *
 * With no argument it scaffolds a throwaway project in a temp dir (two page
 * templates + a few colour/size tokens) so every screen has content,
 * including the WCAG contrast hint. Pass a real project dir to preview that
 * project's actual config instead.
 *
 * FORCE_COLOR=1 is set so colour shows even when stdout is piped (e.g. into
 * `less -R` or `cat -v`); the shipping drivers still gate colour normally
 * via ui/style.
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfig } from "@tender/core";
import {
  initPageSetup, reduce as pageReduce, render as renderPage,
  type PageSetupState
} from "../src/config-edit/page-setup.js";
import {
  initTokenPicker, reduce as tokenReduce, render as renderTokens,
  type TokenPickerState
} from "../src/config-edit/token-picker.js";
import { ansiTheme } from "../src/config-edit/theme.js";

process.env.FORCE_COLOR = "1";

const SAMPLE_YAML = `# Throwaway project for the configurator preview harness.
page-templates:
  default:
    size: A5
    margin: { top: 18mm, bottom: 20mm, inner: 18mm, outer: 14mm }
    headers: { left: "{chapter}", right: "{page}" }
  cover:
    size: A5
    margin: 0
design-tokens:
  color:
    ink: '#1a1a1a'
    page: '#ffffff'
    accent: '#FFE600'
  size:
    body: 12
    h1: 24pt
`;

/** Project YAML for the "empty design tokens" frame — needed to show the
 * full onboarding intro paragraph and examples. */
const SAMPLE_YAML_NO_TOKENS = `page-templates:
  default:
    size: A5
    margin: 0
`;

/** A labelled screen capture. */
function frame(label: string, body: string): void {
  const bar = "─".repeat(Math.max(8, 60 - label.length));
  process.stdout.write(`\n\x1b[7m  ${label}  \x1b[27m ${bar}\n\n`);
  process.stdout.write(body);
  process.stdout.write("\n");
}

/** Feed a sequence of key events through a reducer, returning the end state. */
function drive<S>(
  state: S,
  reduce: (s: S, k: { str?: string; name?: string }) => S,
  keys: ReadonlyArray<{ str?: string; name?: string }>
): S {
  return keys.reduce(reduce, state);
}

const ch = (str: string) => ({ str });
const key = (name: string) => ({ name });
const type = (s: string) => [...s].map(ch);

async function resolveProjectDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const arg = process.argv[2];
  if (arg) {
    return { dir: arg, cleanup: async () => {} };
  }
  const dir = await mkdtemp(join(tmpdir(), "tender-configurator-preview-"));
  await writeFile(join(dir, "project.yaml"), SAMPLE_YAML);
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

async function withEmptyTokensProject<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tender-no-tokens-"));
  try {
    await writeFile(join(dir, "project.yaml"), SAMPLE_YAML_NO_TOKENS);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { dir, cleanup } = await resolveProjectDir();
  try {
    const config = await loadProjectConfig(dir);

    /* ===================== Page setup: list view ===================== */
    const list0 = initPageSetup(config);
    frame("page setup — template list (default highlighted)", renderPage(list0, ansiTheme));

    const listCover = drive<PageSetupState>(list0, pageReduce, [key("down")]);
    frame("page setup — list with cursor on a non-default", renderPage(listCover, ansiTheme));

    // Single-template orientation: the first thing a fresh `tender init`
    // user sees after opting into page setup. Teaches that adding more
    // templates is possible *and* optional.
    await withEmptyTokensProject(async (singleDir) => {
      const singleConfig = await loadProjectConfig(singleDir);
      const singleList = initPageSetup(singleConfig);
      frame(
        "page setup — list with only `default` (single-template intro)",
        renderPage(singleList, ansiTheme)
      );
    });

    /* ===================== Add template sub-flow ===================== */
    const addStart = drive<PageSetupState>(list0, pageReduce, [ch("a")]);
    frame("page setup — add template (empty buffer)", renderPage(addStart, ansiTheme));

    const addTyping = drive<PageSetupState>(addStart, pageReduce, type("appendix"));
    frame("page setup — add template (typing a valid name)", renderPage(addTyping, ansiTheme));

    const addBad = drive<PageSetupState>(list0, pageReduce, [
      ch("a"), ...type("Appendix"), key("return")
    ]);
    frame("page setup — add template (invalid ident error)", renderPage(addBad, ansiTheme));

    const addDup = drive<PageSetupState>(list0, pageReduce, [
      ch("a"), ...type("default"), key("return")
    ]);
    frame("page setup — add template (duplicate name error)", renderPage(addDup, ansiTheme));

    /* ===================== Template view: a populated template ===================== */
    const tmpl0 = drive<PageSetupState>(list0, pageReduce, [key("return")]);
    frame("page setup — template view (default, top of screen)", renderPage(tmpl0, ansiTheme));

    const tmplHeaderMode = drive<PageSetupState>(tmpl0, pageReduce, Array(5).fill(key("down")));
    frame(
      "page setup — template view (cursor on header-mode)",
      renderPage(tmplHeaderMode, ansiTheme)
    );

    const tmplHeaderSlot = drive<PageSetupState>(tmplHeaderMode, pageReduce, [key("down")]);
    frame(
      "page setup — template view (cursor on header.left)",
      renderPage(tmplHeaderSlot, ansiTheme)
    );

    const tmplSlotTyping = drive<PageSetupState>(tmplHeaderSlot, pageReduce, [
      key("return"), ...type("{chapter}")
    ]);
    frame(
      "page setup — template view (typing a header slot)",
      renderPage(tmplSlotTyping, ansiTheme)
    );

    /* ===================== Template view: an empty-headers template ===================== */
    const coverTmpl = drive<PageSetupState>(listCover, pageReduce, [key("return")]);
    frame(
      "page setup — template view (cover: no headers, margin 0)",
      renderPage(coverTmpl, ansiTheme)
    );

    /* ===================== Confirm ===================== */
    const reviewEmpty = drive<PageSetupState>(list0, pageReduce, [ch("n")]);
    frame("page setup — review (no changes)", renderPage(reviewEmpty, ansiTheme));

    const reviewDiff = { ...reviewEmpty } as PageSetupState;
    frame(
      "page setup — review (with diff)",
      renderPage(
        reviewDiff,
        ansiTheme,
        "  default:\n-     size: A5\n+     size: A4\n  cover:"
      )
    );

    /* ===================== Design tokens — populated ===================== */
    const tok0 = initTokenPicker(config);
    frame("tokens — browse (with contrast hint + orientation)", renderTokens(tok0, ansiTheme));

    const tokEditing = drive<TokenPickerState>(tok0, tokenReduce, [
      key("return"), ...type("#c33")
    ]);
    frame("tokens — editing a value", renderTokens(tokEditing, ansiTheme));

    /* ===================== Design tokens — add flow with hints ===================== */
    // Category step opens in pick mode with `color` highlighted.
    const tokAddPickColor = drive<TokenPickerState>(tok0, tokenReduce, [ch("a")]);
    frame(
      "tokens — add: category pick (color highlighted)",
      renderTokens(tokAddPickColor, ansiTheme)
    );

    // Cursor moved to `font` via ←/→.
    const tokAddPickFont = drive<TokenPickerState>(tokAddPickColor, tokenReduce, [
      key("right"), key("right")
    ]);
    frame(
      "tokens — add: category pick (font highlighted)",
      renderTokens(tokAddPickFont, ansiTheme)
    );

    // Cursor on `other` — about to pivot to free-text.
    const tokAddPickOther = drive<TokenPickerState>(tokAddPickColor, tokenReduce, [
      key("left") // wraps to "other"
    ]);
    frame(
      "tokens — add: category pick (other highlighted; ↵ flips to free-text)",
      renderTokens(tokAddPickOther, ansiTheme)
    );

    // After ↵ on `other`: free-text input with the matching hint.
    const tokAddFreetext = drive<TokenPickerState>(tokAddPickOther, tokenReduce, [
      key("return"), ...type("mood")
    ]);
    frame(
      "tokens — add: category free-text (after picking other)",
      renderTokens(tokAddFreetext, ansiTheme)
    );

    // Pick a conventional category → name → value (hex hint shows).
    const tokAddColorValue = drive<TokenPickerState>(tok0, tokenReduce, [
      ch("a"),
      key("return"), // commit "color" (the default pick)
      ...type("link"), key("return")
    ]);
    frame(
      "tokens — add: value step (color category, hex hint)",
      renderTokens(tokAddColorValue, ansiTheme)
    );

    // Pick `size` → name → value (length hint).
    const tokAddSizeValue = drive<TokenPickerState>(tok0, tokenReduce, [
      ch("a"),
      key("right"), key("return"), // pick "size", commit
      ...type("caption"), key("return")
    ]);
    frame(
      "tokens — add: value step (size category, length hint)",
      renderTokens(tokAddSizeValue, ansiTheme)
    );

    // Custom category (via free-text fallback) → no value hint.
    const tokAddCustom = drive<TokenPickerState>(tok0, tokenReduce, [
      ch("a"),
      ...type("mood"), key("return"), // typing flips to free-text, commits "mood"
      ...type("vibes"), key("return")
    ]);
    frame(
      "tokens — add: value step (custom category, no hint)",
      renderTokens(tokAddCustom, ansiTheme)
    );

    const tokAddErr = drive<TokenPickerState>(tok0, tokenReduce, [
      ch("a"), ch("C"), ch("o"), key("return")
    ]);
    frame("tokens — add: invalid ident error", renderTokens(tokAddErr, ansiTheme));

    /* ===================== Design tokens — empty intro ===================== */
    await withEmptyTokensProject(async (emptyDir) => {
      const emptyConfig = await loadProjectConfig(emptyDir);
      const tokEmpty = initTokenPicker(emptyConfig);
      frame(
        "tokens — empty project (full intro + examples)",
        renderTokens(tokEmpty, ansiTheme)
      );
    });

    process.stdout.write(
      `\nPreviewed against: ${dir}\n` +
        (process.argv[2] ? "" : "(throwaway — removed)\n")
    );
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
