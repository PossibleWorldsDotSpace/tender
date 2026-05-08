import { buildProject } from "@tender/core";

export interface LintResult {
  errors: string[];
  warnings: string[];
}

export async function lint(projectDir: string): Promise<LintResult> {
  const result: LintResult = { errors: [], warnings: [] };
  try {
    await buildProject(projectDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
  }
  return result;
}
