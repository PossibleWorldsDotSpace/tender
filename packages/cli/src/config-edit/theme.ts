/**
 * The configurator's shared visual + copy system (#17 slice 5).
 *
 * One source of truth so the two screens (page setup, token picker), their
 * drivers, `tender configure`, and the `tender init` prompts read as ONE
 * voice instead of drifting per file. Two things live here:
 *
 *  1. **Glyphs** — plain Unicode marks (no ANSI), so the pure renderers can
 *     emit structure that is still readable in tests and degrades to legible
 *     text under `NO_COLOR`.
 *  2. **Theme** — a struct of string→string styling functions. Renderers take
 *     a `Theme` and call it for semantic roles (title, cursor, hint, …); they
 *     never reach for raw ANSI. The driver injects `ansiTheme` (real colour
 *     via ui/style, gated by the existing TTY/NO_COLOR/CI detection); tests
 *     and non-TTY paths get `plainTheme` (identity), so asserting on rendered
 *     substrings stays trivial and `NO_COLOR` correctness is automatic.
 *
 * Copy constants also live here. Per the maintainer's standing preference
 * (Tender copy is authored, not scattered): change a word once, here.
 */

import { bold, cyan, dim, green, magenta, red, yellow } from "../ui/style.js";

/** Plain Unicode marks. Chosen to be present in any modern monospace font
 * and to stay meaningful with colour stripped. */
export const glyph = {
  /** Row the cursor is on. Trailing space keeps columns aligned. */
  cursor: "▸",
  cursorOff: " ",
  /** Radio: the selected / unselected member of a small fixed choice. */
  radioOn: "◉",
  radioOff: "○",
  /** A text field the user is typing into (caret). */
  caret: "▏",
  /** Status line severities. */
  ok: "✓",
  warn: "!",
  err: "✗",
  added: "+",
  /** Confirm / review affordance. */
  arrow: "→",
  /** Diff gutter. */
  diffAdd: "+",
  diffDel: "-",
  diffCtx: " "
} as const;

/**
 * Semantic styling roles. A renderer asks for a role ("this is the cursor
 * row", "this is a control hint"); it never decides the colour. The driver
 * decides once, by injecting a Theme.
 */
export interface Theme {
  /** Screen title (the one bold banner line). */
  title(s: string): string;
  /** The highlighted/selected row. */
  cursor(s: string): string;
  /** Secondary guidance — control hints, key legends. */
  hint(s: string): string;
  /** The live value the user is currently typing. */
  editing(s: string): string;
  /** A confirmed-good status / success. */
  ok(s: string): string;
  /** A cautionary status (recoverable, not an error). */
  warn(s: string): string;
  /** An error / invalid input. */
  err(s: string): string;
  /** An added/new item. */
  added(s: string): string;
  /** Diff: an added line. */
  diffAdd(s: string): string;
  /** Diff: a removed line. */
  diffDel(s: string): string;
}

const identity = (s: string): string => s;

/**
 * Render a legend string with the action keys coloured separately from
 * their verbs. Legends across the configurator follow a uniform grammar:
 *
 *   <key>{whitespace}<verb>{4+ spaces}<key>{whitespace}<verb>{4+ spaces}…
 *
 * e.g. `↑↓ move    ↵ open / add    s review    esc cancel`.
 *
 * This splits on runs of two-or-more spaces (the pair separator), then
 * peels the first whitespace-separated token off each pair as the key.
 * Verbs themselves may contain single spaces ("open / add", "change size"),
 * but never four-space runs — that's the contract.
 *
 * Keys render through `theme.cursor` (cyan in ANSI) so they read as
 * actionable; verbs render through `theme.hint` (dim) as secondary text.
 * Falls back gracefully under `plainTheme` (both roles pass-through).
 *
 * Caveat: a few legend strings carry inline parentheticals or punctuation
 * that don't follow the strict grammar (e.g. `↵ edit (type to replace,
 * ↵ on empty keeps)    esc cancel`). The parser still produces a sensible
 * split — everything up to the first space is the "key", the rest the
 * "verb" — but the visual emphasis lands on the leading mark, which is
 * the cue users actually scan for.
 */
export function renderLegend(legend: string, theme: Theme): string {
  const pairs = legend.split(/\s{2,}/);
  return pairs
    .map(pair => {
      const m = /^(\S+)\s+(.+)$/s.exec(pair);
      if (!m) return theme.hint(pair);
      const [, key, verb] = m;
      return `${theme.cursor(key!)} ${theme.hint(verb!)}`;
    })
    .join("    ");
}

/** No colour — pure passthrough. Default for renderers, tests, non-TTY. */
export const plainTheme: Theme = {
  title: identity,
  cursor: identity,
  hint: identity,
  editing: identity,
  ok: identity,
  warn: identity,
  err: identity,
  added: identity,
  diffAdd: identity,
  diffDel: identity
};

/** Real colour. Each fn no-ops itself when colour is disabled (ui/style
 * already gates on TTY / NO_COLOR / CI / TERM=dumb), so the driver can use
 * this unconditionally. */
export const ansiTheme: Theme = {
  title: (s) => bold(s),
  cursor: (s) => cyan(s),
  hint: (s) => dim(s),
  editing: (s) => magenta(s),
  ok: (s) => green(s),
  warn: (s) => yellow(s),
  err: (s) => red(s),
  added: (s) => green(s),
  diffAdd: (s) => green(s),
  diffDel: (s) => yellow(s)
};

/* ------------------------------------------------------------------ */
/* Copy — the authored strings. One place, one voice.                  */
/*                                                                     */
/* Voice rules (slice 5):                                              */
/*  - Speak to the author, plainly. No exclamation, no cheerleading.   */
/*  - Control hints: "key  what it does", keys joined by "  ", lower-   */
/*    case verbs, no terminal punctuation. The hint line is a legend,  */
/*    not a sentence.                                                  */
/*  - Status lines ARE sentences: capitalised, terminal period.        */
/*  - Errors state what's wrong, then what to do, in that order.       */
/*  - "page setup" / "design tokens" are the two screen names; use     */
/*    them verbatim everywhere they're referenced.                     */
/* ------------------------------------------------------------------ */

export const copy = {
  page: {
    title: "Page setup",
    /** Top-level template list. Each template is one summary row; ↵ drills
     * into it. The trailing add-template-row is also navigable via ↵; `a`
     * is the matching shortcut. `default` is immutable (no delete, no
     * rename) for safety — every project relies on it existing. */
    listLegend: "↑↓ move    ↵ open / add    s review    esc cancel",
    /** Shown when the project already has more than the default template
     * — orient the user, get out of the way. */
    listIntro:
      "Your project's page templates. Each has its own size, margins, " +
      "and headers/footers. Pick one to edit, or add another.",
    /** Shown when the project has only `default` — teaches that multiple
     * templates are possible *and* optional. A first-time user should be
     * able to decide "I just need one" or "I'll add another" right here. */
    listIntroSingle:
      "Each page template has its own size, margins, and headers/footers. " +
      "Most projects need just `default`; books, journals, or pieces with " +
      "covers / chapter openers can add more. Edit `default`, or add another.",
    /** The synthetic add-row's label + secondary hint. */
    addRowLabel: "add a page template",
    addRowHint: "front-matter, body, cover, appendix — name it whatever you like",
    /** One-line summary shown in the template list. Compact, scannable. */
    listRowSummary: (size: string, margin: string): string =>
      `${size} · margin ${margin}`,
    /** Inside one template: the editing screen. */
    templateLegend: "↑↓ move    ↵ review & apply    esc back to list",
    legendSizeNamed: "←→ change size    c custom size",
    legendSizeCustom: "w width    h height    c named size",
    /** Shown beneath the size legend on non-default templates only. The
     * PDF's physical sheet is always `default`'s size; per-template sizes
     * change the content area of pages marked with that template. */
    sizeDefaultGovernsSheetHint:
      "Note: the PDF sheet size follows `default`. " +
      "This sets the content area for pages using this template.",
    legendMargin: "+ / −  adjust    u unit    z toggle 0",
    legendHeaderMode: "←→ toggle between none and three slots",
    legendHeaderSlot: "↵ edit (type to replace, ↵ on empty keeps)    esc cancel",
    /** Section dividers inside the template view. */
    sectionPage: "Page",
    sectionHeaders: "Headers (top of every page)",
    sectionFooters: "Footers (bottom of every page)",
    /** The mode-toggle row's display. */
    headerModeNone: "none — no header row",
    headerModeBoxes: "three slots — left · center · right",
    footerModeNone: "none — no footer row",
    footerModeBoxes: "three slots — left · center · right",
    /** Empty-state for a header/footer slot. The schema accepts strings
     * (often interpolations like `{page}` or `{chapter}`); the empty value
     * means the slot is blank but the row exists. */
    slotEmpty: "(empty)",
    slotTypeHint:
      "Type to replace; ↵ on empty keeps the current value. " +
      "Tokens: {page} · {pages} · {title} · {chapter} · {section}.",
    sizeCustomEntered: "Custom size. ←→ to pick a field, ↵ to type it.",
    sizeTypeHint: (dim_: string) =>
      `Type the ${dim_}, ↵ to set it. Empty keeps the current value.`,
    marginZeroHint: "This margin is 0. Press z to give it edges.",
    marginToZero: "Margin set to 0.",
    marginToBox: "Margin now has edges.",
    editCancelled: "Edit cancelled — value unchanged.",
    invalid: (fields: string[]) =>
      `Can't apply: ${fields.join(", ")} ${
        fields.length === 1 ? "isn't a valid length" : "aren't valid lengths"
      } (e.g. 12mm, 1in, 18pt).`,
    /** Add-template sub-flow. */
    addTitle: "Add a page template",
    addLegend: "↵ next    esc cancel",
    addFieldName: "name",
    addNameHint:
      "A short identifier — cover, body, appendix. " +
      "Lowercase letters, digits or “-”, starting with a letter.",
    addBadName:
      "Name must be lowercase letters, digits or “-”, starting with a letter.",
    addDuplicate: (name: string) =>
      `A template named “${name}” already exists. Pick a different name.`,
    addCancelled: "Add cancelled.",
    /** Status when the user tries a destructive action on `default`. */
    defaultImmutable:
      "The default template can't be removed or renamed — every project relies on it."
  },

  tokens: {
    title: "Design tokens",
    /** Short orientation block on the populated screen — what tokens *do*
     * in a Tender project (build-time substitution into your CSS), so a
     * returning user is reminded without re-reading the empty-state intro.
     * Rendered line-by-line like `emptyIntro`. */
    orientation: [
      "Set basic design tokens here, reference them in your components,",
      "and they will be parsed by Tender in the build stage. They live",
      "under `design-tokens:` in project.yaml and your CSS reaches them",
      "as `var(--category-name)`."
    ].join("\n"),
    legend: "↑↓ move    ↵ edit    a add    s review    esc cancel",
    /** Multi-line empty-state intro — only shown when there are no tokens
     * yet. Opens with the same voice as the populated screen's orientation,
     * then teaches the conventional categories with concrete examples so a
     * first-time user has somewhere to start. Rendered as a paragraph block
     * (the renderer wraps it). The closing CTA is in `emptyCallToAction`
     * so the renderer can theme it distinctly. */
    emptyIntro: [
      "Set basic design tokens here, reference them in your components,",
      "and they will be parsed by Tender in the build stage. They live",
      "under `design-tokens:` in project.yaml and your CSS reaches them",
      "as `var(--category-name)`.",
      "",
      "Categories are conventional but open. Common ones:",
      "  color   — hex like #1a1a1a (becomes var(--color-ink) etc.)",
      "  size    — lengths like 12pt, 1.2em, 16px",
      "  font    — family names from your fonts: list",
      "  space   — lengths like 8mm for margins, gaps, indents"
    ].join("\n"),
    /** The empty-state's actionable closing line — themed separately
     * (theme.ok / green) so it pops out of the surrounding descriptive
     * copy. The key (`a`) is what the user actually presses. */
    emptyCallToAction: "Press a to add your first token.",
    /** Add-token sub-flow. */
    addTitle: "Add a token",
    /** Legend used in `name` and `value` steps, and in `category` while in
     * free-text mode. */
    addLegend: "↵ next    esc cancel",
    /** Legend used in `category` step while in pick mode — surfaces the
     * arrow-key affordance plus the "type to invent a category" shortcut. */
    addLegendCategoryPick: "←→ pick category    ↵ next    type your own    esc cancel",
    addFieldCategory: "category",
    addFieldName: "name",
    addFieldValue: "value",
    /** Hint while picking from the conventional categories. */
    categoryPickHint:
      "Pick a common category, or start typing to use your own.",
    /** Hint after the user chose `other` or started typing a custom name. */
    categoryFreetextHint:
      "Use whatever category name you like.",
    /** Per-category value-format hint shown under the value field while
     * typing. `null` means "no hint" (the user's custom category). */
    valueHint: (category: string): string | null => {
      switch (category) {
        case "color": return "Hex like #1a1a1a, or a CSS keyword (red, currentColor).";
        case "size": return "Length like 12pt, 1.2em, 16px, 0.85rem.";
        case "font": return "Family name from your fonts: list, e.g. Inter.";
        case "space": return "Length like 8mm, 1ch, 4px.";
        default: return null;
      }
    },
    badIdent: (what: string) =>
      `${what} must be lowercase letters, digits or “-”, starting with a letter.`,
    duplicate: (path: string) => `${path} already exists.`,
    added: (path: string) => `Added ${path}.`,
    addCancelled: "Add cancelled.",
    editCancelled: "Edit cancelled — value unchanged.",
    contrast: (ratio: number, rating: string) =>
      `color.ink on color.page — ${ratio}:1 contrast (${rating})`,
    newTag: "new"
  },

  /** Shared by both drivers' confirm/review tail. */
  review: {
    heading: (screen: string) => `Review changes to ${screen}`,
    noChanges: "Nothing changed — there's nothing to write.",
    /** Action line for the no-changes branch. Without this the screen looks
     * frozen — the user has nothing to do AND no signal that they can leave.
     * Both keys return the user to the previous screen (the editing view);
     * neither quits the whole CLI flow. "go back" is deliberate copy — the
     * older "esc cancel" wording read as "abort the CLI". */
    noChangesActions: "e keep editing    esc go back",
    /** The action line under the diff. Phrased to make clear that y writes
     * the YAML AND completes this screen (returning to the surrounding init
     * flow); n discards just this screen's edits and does the same; e
     * returns to the editor. The previous "y apply" reading was ambiguous
     * about whether the whole CLI was about to finish. */
    prompt: "Write these changes to project.yaml?",
    actions: "y write & continue    n discard    e keep editing"
  },

  /** Result summaries — used by configure.ts AND the init prompts, so they
   * match. `screen` is "Page setup" / "Design tokens". */
  outcome: {
    applied: (screen: string, n: number) =>
      `${screen}: applied ${n} ${n === 1 ? "change" : "changes"}.`,
    noop: (screen: string) => `${screen}: no changes.`,
    cancelled: (screen: string) => `${screen}: cancelled, nothing written.`,
    /** Follow-up surfaced when the user added at least one new page template.
     * Without this hint the YAML is technically correct but dead — nothing
     * uses a template until source markdown references it. */
    addedTemplatesNextStep: (names: string[]): string => {
      const example = names[0]!;
      const list = names.length === 1
        ? `template "${example}"`
        : `templates ${names.map(n => `"${n}"`).join(", ")}`;
      return `Added ${list}. ` +
        `Use \`=== page{template=${example}}\` in your source to mark ` +
        `pages with ${names.length === 1 ? "it" : "one"}.`;
    }
  },

  /** The init prompts (post-scaffold, optional, default no). Phrased in
   * parallel so the two steps read as siblings under the "Configure"
   * section heading. */
  initPrompt: {
    page: "Set up page templates now? (size, margins, headers)",
    tokens: "Set up design tokens now? (colours, lengths, fonts)"
  },

  /** One canonical non-TTY message. Was three different sentences across
   * page-setup-driver / token-picker-driver / configure.ts. */
  needsTTY: (what: string): string =>
    `${what} is interactive and needs a terminal. ` +
    `For scripts, use \`tender tokens set <token> <value>\` or edit project.yaml directly.`,

  /** configure.ts: project missing. */
  noProject: (dir: string): string =>
    `No project.yaml in ${dir}. Run \`tender init\` here first, ` +
    `or pass the path to an existing project.`,

  /** cli.ts: the impossible flag combination. */
  pageTokensExclusive:
    "--page-only and --tokens-only can't be combined — pick one, or neither for both."
} as const;
