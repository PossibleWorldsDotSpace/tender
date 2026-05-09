import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { preprocessTags } from "./preprocess-tags.js";

/**
 * Equivalence tests against the shared corpus in test/fixtures/tag-corpus.
 * The same fixtures drive @tender/language-server's recovery parser tests
 * (parsers/tag-parser.test.ts). The production preprocessor and the LSP
 * recovery parser must agree on what counts as a tag — diverging behavior
 * between editor and build is a bug.
 *
 * The shared invariant: any corpus entry with diagnosticCount === 0 must
 * preprocess without throwing; any entry with diagnosticCount > 0 must
 * throw. The exact tag-list assertion lives on the LSP side because the
 * recovery parser produces structured TagNodes; the preprocessor outputs
 * a rewritten string and we'd be re-parsing to compare tag-by-tag.
 */

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "../../test/fixtures/tag-corpus");

const REGISTRY = new Set(["row", "callout", "cover-spiral"]);
const INLINE: Set<string> = new Set();

interface Expected {
  tags: { name: string }[];
  diagnosticCount: number;
}

const ENTRIES = [
  "simple-block",
  "with-attrs",
  "nested",
  "self-closing",
  "unclosed",
  "mismatched",
  "inside-code",
  "inside-fenced"
];

describe("preprocessTags vs tag-corpus", () => {
  it.each(ENTRIES)("agrees with corpus on %s", async (name) => {
    const source = await readFile(join(corpusDir, `${name}.md`), "utf8");
    const expected: Expected = JSON.parse(
      await readFile(join(corpusDir, `${name}.expected.json`), "utf8")
    );

    if (expected.diagnosticCount === 0) {
      const result = preprocessTags(source, { registry: REGISTRY, inlineNames: INLINE });
      // Sanity check: every registered tag in the expected list shows up in
      // the rewritten output as a directive (`:::name`). We don't assert
      // exact byte equivalence — the directive form differs from the tag
      // form by design.
      for (const tag of expected.tags) {
        expect(result.source).toContain(`:::${tag.name}`);
      }
    } else {
      expect(() => preprocessTags(source, { registry: REGISTRY, inlineNames: INLINE })).toThrow();
    }
  });
});
