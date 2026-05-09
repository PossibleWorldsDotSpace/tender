import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runGoldenTest, goldenPathFor } from "./golden-test-helper.js";

const here = dirname(fileURLToPath(import.meta.url));
// Walk: src/golden -> src -> render -> packages -> repo root
const fixturesDir = join(here, "../../../core/test/fixtures");

interface FixtureConfig {
  name: string;
  /** When set, run the build under these process.env overrides. */
  env?: Record<string, string>;
}

const FIXTURES: FixtureConfig[] = [
  { name: "hello" },
  { name: "components" },
  { name: "page-templates" },
  { name: "with-image" },
  { name: "coastal-planet" },
  { name: "coastal-planet-tender" },
  // The tag-syntax fixture mirrors coastal-planet-tender's content but
  // authored with <row>…</row> tags. It builds under TENDER_TAG_SYNTAX=1
  // and its golden must equal coastal-planet-tender.json — proof that the
  // preprocessor produces equivalent output to legacy `:::row` directive
  // syntax.
  { name: "coastal-planet-tags", env: { TENDER_TAG_SYNTAX: "1" } }
];

describe("PDF golden tests", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: PDF structure matches golden`, async () => {
      const restoreEnv: Record<string, string | undefined> = {};
      if (fixture.env) {
        for (const [k, v] of Object.entries(fixture.env)) {
          restoreEnv[k] = process.env[k];
          process.env[k] = v;
        }
      }
      try {
        const { actual, expected, updated } = await runGoldenTest({
          fixtureDir: join(fixturesDir, fixture.name),
          goldenPath: goldenPathFor(here, fixture.name)
        });

        if (updated) {
          // First run or TENDER_UPDATE_GOLDENS=1: golden was just written.
          expect(actual.pageCount).toBeGreaterThan(0);
          return;
        }
        expect(expected).not.toBeNull();
        expect(actual).toEqual(expected);
      } finally {
        for (const [k, prev] of Object.entries(restoreEnv)) {
          if (prev === undefined) delete process.env[k];
          else process.env[k] = prev;
        }
      }
    }, 120_000);
  }
});
