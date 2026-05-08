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
  "coastal-planet"
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
        // Don't fail the test — but signal so the user notices.
        expect(actual.pageCount).toBeGreaterThan(0);
        return;
      }
      expect(expected).not.toBeNull();
      // Compare the whole structure: page count, dimensions, text per page.
      expect(actual).toEqual(expected);
    }, 120_000);
  }
});
