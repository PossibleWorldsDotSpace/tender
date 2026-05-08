/**
 * Helpers for golden-style PDF tests. The tests render a fixture project to
 * PDF, extract a stable structure, and compare against a JSON golden file.
 *
 * The goldens are environment-sensitive: pinned Chromium + pinned fonts in
 * CI keeps them stable. To regenerate after intentional changes, run with
 * `TENDER_UPDATE_GOLDENS=1 pnpm test`. The new goldens will overwrite the
 * old ones — review the diff before committing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { buildProject } from "@tender/core";
import { renderPdf } from "../render.js";
import { extractPdfStructure } from "./extract-pdf.js";
import type { PdfStructure } from "./extract-pdf.js";

export interface GoldenTestOptions {
  fixtureDir: string;
  goldenPath: string;
}

export async function runGoldenTest(opts: GoldenTestOptions): Promise<{
  actual: PdfStructure;
  expected: PdfStructure | null;
  updated: boolean;
}> {
  const built = await buildProject(opts.fixtureDir);
  const pdf = await renderPdf(built);
  const actual = await extractPdfStructure(new Uint8Array(pdf));

  const updateMode = process.env.TENDER_UPDATE_GOLDENS === "1";
  if (updateMode || !existsSync(opts.goldenPath)) {
    await mkdir(dirname(opts.goldenPath), { recursive: true });
    await writeFile(opts.goldenPath, JSON.stringify(actual, null, 2) + "\n");
    return { actual, expected: null, updated: true };
  }

  const expectedRaw = await readFile(opts.goldenPath, "utf8");
  const expected = JSON.parse(expectedRaw) as PdfStructure;
  return { actual, expected, updated: false };
}

export function goldenPathFor(testFileDir: string, fixtureName: string): string {
  return join(testFileDir, "golden", `${fixtureName}.json`);
}
