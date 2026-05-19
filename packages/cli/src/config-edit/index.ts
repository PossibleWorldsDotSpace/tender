// Public surface of the config-edit module. The shared engine
// (values/document) is flat; the two interactive screens expose only their
// drivers (the entry points slice 4 wires to commands) — their pure
// reducers/renderers share names (reduce/render/collectEdits/KeyEvent) and
// stay internal, imported directly by their own driver + tests.
export * from "./values.js";
export * from "./document.js";
export { runPageSetup } from "./page-setup-driver.js";
export type { PageSetupIO, PageSetupResult } from "./page-setup-driver.js";
export { runTokenPicker } from "./token-picker-driver.js";
export type { TokenPickerIO, TokenPickerResult } from "./token-picker-driver.js";
// Shared copy + visual system (slice 5). `copy` is the single authored-string
// surface; cli.ts / configure.ts reference it so prompts and summaries match
// the screens.
export { copy, glyph } from "./theme.js";
