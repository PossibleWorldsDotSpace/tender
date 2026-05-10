import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { cleanText, totalChanges, loadProjectConfig } from "@tender/core";
import type { CleanResult } from "@tender/core";

export interface CleanCliOptions {
  /** --check: don't write; exit 1 if changes pending. */
  check?: boolean;
  /** --yes: skip the [y/N] prompt; write immediately. */
  yes?: boolean;
  /** --typography: enable rule 8 for this invocation. */
  typography?: boolean;
  /**
   * Read user input. Default reads from process.stdin (one chunk); tests
   * inject a fake. Returns "y", "yes", or anything else (treated as "no").
   */
  prompt?: () => Promise<string>;
}

export interface CleanCliResult {
  result: CleanResult;
  /** What we did with the result. */
  action: "no-changes" | "wrote" | "skipped" | "check-clean" | "check-dirty";
  summary: string;
  exitCode: number;
}

/**
 * Run tender clean against a single file. The file is resolved relative to
 * the cwd; project.yaml in the same directory (if present) provides the
 * `clean.typography` setting.
 */
export async function clean(
  filePath: string,
  opts: CleanCliOptions = {}
): Promise<CleanCliResult> {
  const absolute = resolve(filePath);
  const projectDir = dirname(absolute);

  // Resolve typography preference: CLI flag wins; otherwise project config.
  let typography = opts.typography ?? false;
  if (!typography) {
    try {
      const config = await loadProjectConfig(projectDir);
      typography = config.clean?.typography === "smart";
    } catch {
      // No project.yaml or unparseable; treat as no preference.
    }
  }

  const source = await readFile(absolute, "utf8");
  const result = await cleanText(source, { typography });

  const fileLabel = basename(absolute);
  const total = totalChanges(result);

  if (total === 0) {
    return {
      result,
      action: "no-changes",
      summary: `${fileLabel}: no changes.`,
      exitCode: 0
    };
  }

  // --check: report and exit; never write.
  if (opts.check) {
    return {
      result,
      action: "check-dirty",
      summary: formatChangeSummary(fileLabel, result, true),
      exitCode: 1
    };
  }

  const summary = formatChangeSummary(fileLabel, result, false);

  // --yes: write immediately.
  if (opts.yes) {
    await writeFile(absolute, result.output);
    return { result, action: "wrote", summary, exitCode: 0 };
  }

  // Default: print summary, prompt.
  const promptFn = opts.prompt ?? defaultPrompt;
  process.stdout.write(`${summary}\n${total} change${total === 1 ? "" : "s"}. Apply? [y/N] `);
  const answer = (await promptFn()).trim().toLowerCase();
  if (answer === "y" || answer === "yes") {
    await writeFile(absolute, result.output);
    return { result, action: "wrote", summary, exitCode: 0 };
  }
  return { result, action: "skipped", summary, exitCode: 0 };
}

export function formatChangeSummary(
  fileLabel: string,
  result: CleanResult,
  forCheck: boolean
): string {
  const lines: string[] = [`${fileLabel}:`];
  for (const c of result.changes) {
    lines.push(`  ${c.description}`);
  }
  if (forCheck) {
    lines.push("");
    lines.push("Run `tender clean` (without --check) to apply these changes.");
  }
  return lines.join("\n");
}

async function defaultPrompt(): Promise<string> {
  return new Promise(res => {
    process.stdin.once("data", chunk => res(chunk.toString()));
  });
}
