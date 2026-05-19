/**
 * `tender configure` — the standalone, re-runnable form of the interactive
 * project configurator (#17 slice 4). Runs the page-setup screen and/or the
 * design-token picker against an existing project, each ending in the
 * mandatory diff-before-write. Does NOT scaffold or touch git/skill — that
 * is `tender init`'s job; configure only adjusts project.yaml.
 *
 * The screen logic + AST-preserving writes live in config-edit/; this
 * orchestrates the two drivers and reports a combined summary. Copy here is
 * provisional (#17 slice 5).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  runPageSetup, runTokenPicker, copy,
  type PageSetupResult, type TokenPickerResult
} from "../config-edit/index.js";

export interface ConfigureOptions {
  /** Run only the page-setup screen. */
  pageOnly?: boolean;
  /** Run only the token picker. */
  tokensOnly?: boolean;
  /** Injected for tests; defaults to process.stdin.isTTY. */
  isTTY?: boolean;
}

export interface ConfigureResult {
  page?: PageSetupResult;
  tokens?: TokenPickerResult;
  /** A single human-readable summary line per screen that ran. */
  lines: string[];
}

function summarize(
  label: string,
  r: PageSetupResult | TokenPickerResult
): string {
  switch (r.outcome) {
    case "applied":
      return copy.outcome.applied(label, r.editCount);
    case "no-op":
      return copy.outcome.noop(label);
    case "cancelled":
      return copy.outcome.cancelled(label);
  }
}

/**
 * Run the configurator against `projectDir`. Validates the project exists
 * and is interactive up front (a wizard has no non-interactive meaning);
 * callers surface the thrown error and point at `tender tokens set` /
 * hand-editing for scripts.
 *
 * Order is page setup → tokens (physical page first, then visual
 * vocabulary). Each is independent; cancelling one still lets the other
 * run. Selection flags narrow to a single screen.
 */
export async function configure(
  projectDir: string,
  opts: ConfigureOptions = {}
): Promise<ConfigureResult> {
  if (!existsSync(join(projectDir, "project.yaml"))) {
    throw new Error(copy.noProject(projectDir));
  }

  const isTTY = opts.isTTY ?? process.stdin.isTTY === true;
  if (!isTTY) {
    throw new Error(copy.needsTTY("`tender configure`"));
  }

  const runPage = !opts.tokensOnly;
  const runTokens = !opts.pageOnly;

  const result: ConfigureResult = { lines: [] };

  if (runPage) {
    const page = await runPageSetup(projectDir, { isTTY });
    result.page = page;
    result.lines.push(summarize(copy.page.title, page));
    if (page.outcome === "applied" && page.addedTemplates.length > 0) {
      result.lines.push(copy.outcome.addedTemplatesNextStep(page.addedTemplates));
    }
  }

  if (runTokens) {
    const tokens = await runTokenPicker(projectDir, { isTTY });
    result.tokens = tokens;
    result.lines.push(summarize(copy.tokens.title, tokens));
  }

  return result;
}
