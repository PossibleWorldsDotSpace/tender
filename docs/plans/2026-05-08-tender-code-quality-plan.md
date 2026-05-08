# Tender Code Quality & Correctness — Plan

> Scope: a focused sweep of code-quality, correctness, performance, and test-infrastructure issues surfaced in the initial code review. Independent of the authoring-experience plan (`2026-05-08-tender-authoring-experience-plan.md`); intended as a separate beat that should land *before* big language changes (B, I) so regressions are caught.

These items are smaller and more isolated than the authoring-experience work. None of them change the source language, the user interface, or external behavior. Most are invisible to end users — they make the codebase healthier, faster, and more trustworthy under change.

## Items in priority order

| # | Item | Type | Cost | Why this priority |
|---|---|---|---|---|
| 1 | Remove dead `parseMarkdown` | Cleanup | Trivial | Free win; eliminates a misleading export. |
| 2 | Fix fragile page-wrap heuristic in `build.ts:24` | Refactor | Small | Wrong abstraction layer; will silently break if the built-in page wrapper ever changes. |
| 3 | Replace regex-based `inlineAssets` with HTML parser | Correctness | Small | Quiet failure mode; mishandles realistic HTML. |
| 4 | Document `--no-sandbox` in README | Docs | Trivial | Security-relevant; honest disclosure. |
| 5 | Investigate `coastal-planet` cover-spiral fallback | Investigation | Small | A real author hit a directive seam edge case; either fix or document. |
| 6 | PDF golden tests | Test infra | Medium | Without these, big language changes (B, I) can silently break PDF output. **Land before authoring-experience B and I.** |
| 7 | Hyphenation/orphans/widows verification | Test infra | Small | Companion to #6. |
| 8 | Persistent Chromium for preview server | Performance | Medium | Compounds with every authoring-experience improvement; the inner-loop wait is paid every save. |
| 9 | Soften 60s render timeout | Robustness | Small | Long docs may legitimately exceed it. |
| 10 | Refactor `compose/project-css.ts` verso/recto branching | Refactor | Medium | Densest file in the repo; hard to change safely. Partly relieved by authoring-plan I. |

The order broadly follows: cleanup → correctness → docs → investigations → test infrastructure → performance → robustness → refactor. Cheaper-to-do-first items remove distractions and lower the cost of the bigger ones.

---

## 1. Remove dead `parseMarkdown`

### What

`packages/core/src/parse/markdown.ts` exports `parseMarkdown` (lines 9-14). The function is not used anywhere in the runtime pipeline — `parseProject` (`parse/project-parser.ts`) is the live path. The only reference to `parseMarkdown` is its own test.

### Fix

- Delete `packages/core/src/parse/markdown.ts`.
- Delete `packages/core/test/parse/markdown.test.ts`.
- Run the full test suite to confirm no other code reaches it.
- Check if any export from the package's barrel/`index.ts` re-exports `parseMarkdown` and remove that too.

### Risk

None. It's truly dead.

### Verification

`tsc --noEmit` clean; `pnpm test` green; `grep -r parseMarkdown packages/` returns zero results.

---

## 2. Fix fragile page-wrap heuristic in `build.ts:24`

### What

`packages/core/src/build.ts:24`:

```ts
const bodyHtml = /^\s*<div class="page"/.test(parsed) ? parsed : `<div class="page">${parsed}</div>`;
```

This regex sniffs the parser's *string output* to decide whether to wrap. It conflates parser and composer concerns: `build.ts` is asking "did the source open with `:::page`?" but answering it via a property of the rendered HTML. If the built-in page template's HTML ever changes (different tag, different class, an outer wrapper added), the regex stops matching and the wrapping silently double-wraps or fails to wrap.

### Fix

`parseProject` returns a structured signal indicating whether the document opened with an explicit page directive:

```ts
// packages/core/src/parse/project-parser.ts
export interface ParseResult {
  html: string;
  startsWithPage: boolean;  // NEW
}

export async function parseProject(md: string, config: ProjectConfig): Promise<ParseResult>
```

Detection happens at the AST level — the directive parser already walks the tree, so checking whether the first non-whitespace block node is a `containerDirective` named `page` is a one-line check. Then in `build.ts:24`:

```ts
const bodyHtml = parsed.startsWithPage
  ? parsed.html
  : `<div class="page">${parsed.html}</div>`;
```

### Risk

Small. `parseProject`'s return type is internal — callers are within the same package. Update the build/test fixtures that consume it.

### Verification

- All existing fixtures produce identical output (compare PDF/HTML byte-for-byte before and after).
- New unit test in `parse/project-parser.test.ts`: assert `startsWithPage` is `true` for content opening with `::::page` and `false` for content opening with a heading.

---

## 3. Replace regex-based `inlineAssets` with HTML parser

### What

`packages/render/src/inline-assets.ts:14`:

```ts
const imgRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g;
```

This regex breaks on:

- Multi-line `<img>` tags (newlines between attributes).
- Single-quoted attribute values mixed with double-quoted ones in the same tag.
- `srcset` (ignored entirely; would silently not inline responsive images if/when added).
- Tags with `>` inside attribute values (rare but legal).
- HTML comments containing `<img>` strings.

Failures are quiet — the asset is left as a relative URL, which then breaks when the standalone HTML is opened from a different directory.

### Fix

Use a real HTML parser. Two options:

- **`cheerio`** — already a likely dep candidate from the lint plan (item H of the authoring plan). Familiar API, jQuery-like.
- **`parse5`** + `parse5-htmlparser2-tree-adapter`** — lower-level, closer to spec, what cheerio uses underneath.

Recommend cheerio for ergonomics.

```ts
import { load } from "cheerio";

export async function inlineAssets(html: string, projectDir: string): Promise<string> {
  const $ = load(html, { decodeEntities: false });
  const inlinings: Array<Promise<void>> = [];

  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src || isExternal(src) || isDataUri(src)) return;
    const ext = extname(src).toLowerCase();
    const mime = MIME_TYPES[ext];
    if (!mime) return;

    const targetPath = resolve(projectDir, src);
    if (!isInsideProjectDir(targetPath, projectDir)) return;

    inlinings.push(
      readFile(targetPath)
        .then(buf => { $(el).attr("src", `data:${mime};base64,${buf.toString("base64")}`); })
        .catch(() => { /* leave as-is on read failure */ })
    );
  });

  await Promise.all(inlinings);
  return $.html();
}
```

`decodeEntities: false` matters — without it cheerio re-encodes entities and changes byte output unnecessarily.

### Risk

Slight: cheerio's `$.html()` may normalize whitespace, attribute order, or self-closing tags differently from the input. Test against existing fixtures and assert that **inlined-asset output diffs only in the `src` attribute values**, nothing else.

If the normalization is too disruptive, fall back to parse5 which preserves more of the original.

### Verification

- Existing fixture `with-image` produces an HTML output where `<img>` tags have `data:` URIs. ✅ already true; this change keeps it true.
- New fixture: `<img>` tag split across multiple lines with attributes interleaved. Assert it inlines.
- New fixture: HTML comment containing `<img src="should-not-inline.png">`. Assert it does *not* inline.
- Path-traversal: `<img src="../../etc/passwd">` is rejected (`isInsideProjectDir` returns false).

---

## 4. Document `--no-sandbox` in README

### What

`packages/render/src/render.ts:91-92` and `:116-117` launch Chromium with `--no-sandbox`. The code comments explain why (Ubuntu hosts disable unprivileged user namespaces) but the README doesn't mention it. Users running Tender in less controlled environments (CI runners, shared servers) deserve to know.

### Fix

Add a "Security considerations" section to the top-level README and the user-guide:

> Tender renders documents in a headless Chromium instance launched with `--no-sandbox`. This is required on many Linux hosts (including most CI environments) where unprivileged user namespaces are disabled. The tradeoff: the rendering process runs without Chromium's normal sandbox isolation. Only run Tender on source you trust. Because Tender renders local fixtures you author, the practical risk is low — but if you ever pipe untrusted Markdown or YAML into Tender (e.g. as part of a hosted service), the sandbox flag deserves explicit review.

Also: surface the flag in `--help` output for `tender build` and `tender preview`.

### Risk

None.

### Verification

README and user-guide changes; no code change. Optional: add a `--sandbox` flag to opt back in for users who control their environment, with a startup error if Chromium can't launch.

---

## 5. Investigate `coastal-planet` cover-spiral fallback

### What

In `packages/core/test/fixtures/coastal-planet/content.md:24`, the author wrote raw HTML:

```
<div class="cover-spiral"><img src="assets/images/spiral.png" alt=""></div>
```

…instead of the registered `:::cover-spiral` template (declared in `project.yaml:67`). This is the *only* place in the fixture where a registered template was bypassed in favor of raw HTML. Since the worked example is intended as the gold standard, this is suspicious — either there's a parser bug, a slot/positioning edge case, or an authoring choice that wasn't documented.

### Fix

This is investigation, not implementation:

1. Reproduce: temporarily replace the raw HTML at line 24 with `:::cover-spiral` and rebuild.
2. Compare PDF output byte-by-byte. If identical, it was just authoring style — replace and document.
3. If different, characterize the difference. Likely candidates:
   - The directive form requires a body; `:::cover-spiral` with no body may render an empty `<div>`.
   - Position-specific behavior: the `:::cover-spiral` directive falls inside the `:::row` from line 14-22 in source order, but the raw HTML is *outside* a row and renders correctly. This would be a real edge case worth fixing.
   - Markdown-vs-directive precedence around blank-line rules.

### Outcomes

- **If it was authoring style:** replace raw HTML with directive form, add a comment in the fixture explaining the original intent.
- **If it's a parser bug:** fix it (this is `parse/templates.ts` or `parse/project-parser.ts`); add a regression test.
- **If it's a fundamental limitation:** document the constraint clearly in the user-guide, and consider whether the lint plan's `tender/raw-html-with-known-class` warning should have an exception for this case.

### Risk

The investigation may uncover a deeper issue. That's the point.

---

## 6. PDF golden tests

### What

The design doc (`docs/plans/2026-05-08-tender-design.md:300`) acknowledges PDFs aren't pixel-diffed. `packages/render/test/render.test.ts` is 31 lines and only checks "did rendering not throw." This means **any change to the render pipeline (Paged.js version, Chromium version, CSS generation) can silently break PDF output and pass CI.**

This becomes acute when authoring-plan items B (implicit pages) and I (template composition) land — both touch the parser/composer in ways that are hard to verify without comparing rendered output.

### Fix

A golden-file test infrastructure. Three candidate approaches:

**a) Hash-based.** For each fixture, render to PDF, take SHA-256 of the bytes, store the expected hash in the test. Trivial to implement, brittle: any Chromium version bump or font-rendering tweak breaks every test.

**b) PDF text + structure extraction.** Use `pdf-parse` or `pdfjs-dist` to extract text content, page count, page dimensions, and basic structure. Compare extracted JSON against a golden JSON file. Robust to rendering tweaks, catches structural regressions.

**c) Pixel-diff.** Render PDF → PNG per page, diff against golden PNGs with `pixelmatch`. Threshold-based (allow N% pixel difference). Catches visual regressions that (b) misses, but environment-sensitive.

Recommend **(b) as the foundation, with (c) as an opt-in for visual-critical fixtures**. (a) is too brittle to be useful.

### Implementation sketch

```
packages/render/test/golden/
  coastal-planet.golden.json   # extracted structure
  coastal-planet.golden.png/   # per-page renders (opt-in)
  hello.golden.json
  …
packages/render/test/golden.test.ts
  - For each fixture, render to PDF.
  - Extract structure (text, page count, page sizes, font usage).
  - Compare against golden JSON.
  - On mismatch: pretty diff + instruction to run `pnpm test:golden:update`.
```

A `pnpm test:golden:update` script regenerates goldens after intentional changes. The diff between old and new goldens becomes part of the PR.

### Fixtures to cover

- `hello` (smallest sanity check).
- `components` (component rendering).
- `page-templates` (page-template variations).
- `with-image` (asset inlining).
- `coastal-planet` (the big one — multi-page, templates, slots, page templates).
- A new `verso-recto` fixture covering header/footer mirror behavior.
- A new `first-page-suppression` fixture covering `headers: none` + `headers-rest`.

### Risk

CI environment variance. Headless Chromium on macOS vs Linux may produce subtly different rendering. Mitigations:

- Run goldens in a single canonical environment (Docker image with pinned Chromium + fonts) for the CI authority.
- Allow local dev to skip golden tests or run them informationally; only enforce in CI.
- Pin `puppeteer`'s Chromium version explicitly in `package.json`.

### Verification

The golden infrastructure itself is the verification. Once landed: every authoring-plan PR (B, I especially) shows golden diffs as part of its PR review.

---

## 7. Hyphenation/orphans/widows verification

### What

`packages/core/src/compose/project-css.ts` emits CSS for hyphenation, orphans, and widows. There's no test that the rendered Chromium output actually applies them. A regression in the CSS generation, or a change in Paged.js polishing, could silently disable these features.

### Fix

A small set of fixtures with known-overflowing text, tested against rendered output:

```
packages/render/test/typography.test.ts
  - Fixture: a paragraph long enough to wrap, with a long word (e.g. "antidisestablishmentarianism") near a line boundary.
  - Render to HTML/PDF.
  - Assert the rendered DOM/text shows hyphenation breakpoints (soft hyphens or actual line breaks).
  - Fixture: a paragraph that should produce orphans without the orphan rule.
  - Assert the orphan rule pushed lines to the next page.
```

This is a smaller, more focused version of #6. Could land as part of the same golden-test infrastructure.

### Risk

Hyphenation in Chromium is dictionary-based and locale-sensitive. The test must set `lang` explicitly and pin to a stable dictionary version (Chromium ships with hyphenation data; the version is tied to Chromium version, which #6 already pins).

### Verification

Tests pass on the pinned Chromium; hyphenation produces visible breaks in the assertion text.

---

## 8. Persistent Chromium for preview server

### What

`packages/render/src/render.ts:90-101` (`renderHtml`) and `:115-126` (`renderPdf`) each call `puppeteer.launch(...)` and `browser.close()` per invocation. Cold-start cost is ~1-3 seconds per render. **Confirmed:** `packages/cli/src/commands/preview.ts:124` calls `renderHtml(cachedBuildResult)` from scratch on every file save.

So every save in the live-preview loop pays the full Chromium cold-start. With the LSP work landing (authoring-plan E), the inner loop becomes much tighter and this becomes the dominant wait.

### Fix

A persistent browser instance, owned by the preview server, reused across rebuilds. The render package needs to expose a small lifecycle API:

```ts
// packages/render/src/render.ts
export interface RenderSession {
  renderHtml(input: RenderInput): Promise<string>;
  renderPdf(input: RenderInput): Promise<Buffer>;
  close(): Promise<void>;
}

export async function createRenderSession(): Promise<RenderSession> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  return {
    renderHtml: async (input) => {
      const page = await setupPage(input, browser);
      try {
        const html = await page.content();
        return await inlineAssets(stripPagedJsScript(html), input.projectDir);
      } finally {
        await page.close();
      }
    },
    renderPdf: async (input) => { /* analogous */ },
    close: () => browser.close(),
  };
}
```

The standalone `renderHtml` and `renderPdf` exports remain (they create a session, render, close), so `tender build` doesn't change. The preview server creates a session at startup, reuses it across rebuilds, and closes on shutdown.

```ts
// packages/cli/src/commands/preview.ts (sketch)
const session = await createRenderSession();
process.on("SIGINT", async () => { await session.close(); process.exit(); });
// in the rebuild handler:
const html = await session.renderHtml(cachedBuildResult);
```

### Tricky bits

- **Page leakage.** Each render currently creates a new page via `browser.newPage()`. Make sure pages are closed in `finally` blocks, otherwise the browser accumulates pages across rebuilds.
- **Request interception state.** `page.setRequestInterception(true)` is set per-page in `setupPage`. With per-page lifecycle this is fine; double-check no interception state leaks at the browser level.
- **Crash recovery.** If the browser crashes (OOM on a huge doc), the session needs to detect and re-launch. Add a `browser.on("disconnected", ...)` handler that recreates the browser on next render.

### Risk

State pollution between renders if pages aren't fully isolated. Mitigation: explicit per-render `browser.newPage()` + `page.close()` rather than reusing a single page.

### Verification

- Time `tender preview` rebuild on `coastal-planet` fixture before/after. Expected: 1-3s reduction per save.
- Stress test: 100 consecutive rebuilds; assert browser process count stays at 1, page count returns to 0 between renders, memory stable.
- Crash recovery: kill the Chromium process mid-preview; assert next save recovers.

---

## 9. Soften 60s render timeout

### What

`packages/render/src/render.ts:54`:

```ts
const timer = setTimeout(() => reject(new Error("paged.js render timeout")), 60_000);
```

A blunt 60s cap inside the page-evaluate. Long documents (a 200-page book) may legitimately exceed this on slower hardware. The error message is unhelpful — author sees "paged.js render timeout" with no indication of why or what to do.

### Fix

Two changes:

1. **Make the timeout configurable.** Add a `timeoutMs` field to `RenderInput`, defaulting to 60s for sanity but overridable from the CLI (`--timeout 300`) and from `project.yaml` (`render.timeout-ms`).
2. **Better error message.** When the timeout fires, surface diagnostics: page count rendered so far, time elapsed, suggestion to increase the timeout. Capture this from inside the `page.evaluate` callback.

```ts
const timer = setTimeout(() => {
  reject(new Error(
    `Paged.js render exceeded ${timeoutMs}ms. ` +
    `If your document is long, try --timeout ${timeoutMs * 2}ms or set ` +
    `render.timeout-ms in project.yaml.`
  ));
}, timeoutMs);
```

A more ambitious option (deferred): scale the timeout with document length — count source pages or blocks at parse time and grant N seconds per page. Not worth the complexity yet.

### Risk

None.

### Verification

- Existing tests pass with default 60s.
- New test: synthetic input that takes > 60s with default, succeeds with `--timeout 120000`.
- New test: timeout error message includes the suggestion text.

---

## 10. Refactor `compose/project-css.ts` verso/recto branching

### What

`packages/core/src/compose/project-css.ts` is 298 lines, the densest file in the repo. The verso/recto + first-page-suppression branching at lines 138-204 is hard to follow: helpers `restBoxes` and `restVersoRectoSide` are barely used, the branching mixes "is this a verso/recto template?" with "is first-page suppressed?" with "is this the rest pages?" Each combination has its own emit path. It works (tests confirm) but is fragile.

### Fix

Introduce a normalized intermediate shape. Each page template, regardless of how its headers/footers are configured, gets reduced to:

```ts
interface ResolvedPageTemplate {
  name: string;
  geometry: { size, margin, bleed };
  headers: {
    first?: { left, center, right };   // first page of this template only
    rest:  { left, center, right };    // all subsequent pages
    leftPage?: { left, center, right };  // verso (combined with rest)
    rightPage?: { left, center, right }; // recto (combined with rest)
  };
  footers: { /* same shape */ };
}
```

The resolution logic — collapsing `headers: none` + `headers-rest`, expanding `left-page` / `right-page`, applying defaults — happens once, in a single function. The CSS emitter then walks this shape with no branching, just one rule per non-empty bucket.

This is partly relieved by authoring-plan **I (template composition)** because shared CSS can be factored at the template level, but the page-template specifically (`@page` rules, `string-set`, named pages) doesn't fit that mechanism — it needs the structural cleanup directly.

### Risk

Medium. This is the trickiest refactor in this plan because the existing tests cover the *current* code paths, not the abstract behavior. Strategy:

1. Land the PDF golden tests (#6) first.
2. Then refactor; goldens catch any regression.
3. Don't change observable behavior in this PR — just the internal structure.

### Verification

- All existing fixture outputs unchanged (golden diffs empty).
- `compose/project-css.test.ts` still passes (its assertions are about CSS output, which doesn't change).
- New unit tests for the normalization function: each header/footer config form produces the expected normalized shape.

---

## Out of scope

- Anything user-visible (covered by the authoring-experience plan).
- Migrating off Paged.js or off Puppeteer — too big, separate question.
- Dropping CommonJS / dual-package fixes — fine as is.
- TypeScript strictness tightening — separate exercise; current strictness is reasonable.
- Performance work in `parseProject` — the parser is fast enough; preview rebuild time is dominated by Chromium (item #8), not parsing.

## Done definition

- All 10 items addressed (or explicitly deferred with rationale).
- Test suite green; PDF golden tests in place.
- A baseline preview rebuild time measurement for `coastal-planet` documented in the README or docs (so future regressions are visible).
- README documents the `--no-sandbox` consideration.

## Sequencing relative to authoring-experience plan

| Priority | When | Item |
|---|---|---|
| Must land before authoring B & I | First | #6 PDF golden tests |
| Must land before authoring B & I | First | #7 typography verification |
| Should land before LSP feels great | Early | #8 persistent Chromium |
| Independent of authoring plan | Anytime | #1, #2, #3, #4, #9 |
| Investigation; informs authoring H | Anytime | #5 |
| Best after #6 lands | Later | #10 |

A reasonable beat: ship #1-#4 in one PR (cleanup + correctness + docs), #5 as an investigation issue, #6-#7 as the test-infrastructure beat, #8-#9 as the performance beat, #10 last. Three to four PRs over a focused week or so.
