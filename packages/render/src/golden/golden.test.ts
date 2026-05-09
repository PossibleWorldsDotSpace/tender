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
  "coastal-planet",
  "coastal-planet-tender",
  // Authored with <row>…</row> tag syntax (the new default). Its golden is
  // byte-identical to coastal-planet-tender.json — proof that the
  // preprocessor produces the same output as the legacy `:::row` path.
  "coastal-planet-tags"
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
