import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runGoldenTest, goldenPathFor } from "./golden-test-helper.js";

const here = dirname(fileURLToPath(import.meta.url));
// Walk: src/golden -> src -> render -> packages -> repo root
const fixturesDir = join(here, "../../../core/test/fixtures");

const FIXTURES = [
  "hello",
  "components",
  "page-templates",
  "with-image",
  "open-circle",
  "open-circle-tender",
  // Authored with <row>…</row> tag syntax (the new default). Its golden is
  // byte-identical to open-circle-tender.json — proof that the
  // preprocessor produces the same output as the legacy `:::row` path.
  "open-circle-tags",
  // Mirrors open-circle-tags but exercises item 6's inline-shortcuts:
  // declares `|`: stage-direction and rewrites a few inline span uses.
  "open-circle-shortcuts"
];

describe("PDF golden tests", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture}: PDF structure matches golden`, async () => {
      const { actual, expected, updated } = await runGoldenTest({
        fixtureDir: join(fixturesDir, fixture),
        goldenPath: goldenPathFor(here, fixture)
      });

      if (updated) {
        // First run or TENDER_UPDATE_GOLDENS=1: golden was just written.
        expect(actual.pageCount).toBeGreaterThan(0);
        return;
      }
      expect(expected).not.toBeNull();
      expect(actual).toEqual(expected);
    }, 120_000);
  }
});
