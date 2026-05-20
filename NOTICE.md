# Third-party notices

`@possibleworlds/tender` is MIT-licensed (see [`LICENSE`](LICENSE)). It bundles or depends on the following third-party software. The package is published as MIT and we make no representation about your obligations under the *upstream* licenses listed below — please consult each project's source for the authoritative terms.

## Bundled in the published tarball

These ship inside the `npm install @possibleworlds/tender` payload:

### Fonts (`dist/preview-ui/assets/`)

Used by the preview UI chrome (Palette, Help, Export tabs). They are **not** applied to your rendered documents.

| Font | License | Source |
| --- | --- | --- |
| JetBrains Mono (Regular, Medium, Bold) | SIL Open Font License 1.1 | <https://github.com/JetBrains/JetBrainsMono> |
| Libre Baskerville (Regular, Italic, Bold) | SIL Open Font License 1.1 | <https://github.com/impallari/Libre-Baskerville> |
| Reglo (Bold) | Possible Worlds; redistributed with permission | — |

SIL OFL 1.1 full text: <https://openfontlicense.org/open-font-license-official-text/>.

### figlet "ANSI Regular"

The `tender` wordmark printed by `tender init` and `tender preview` is an ASCII-art string baked into source. It was generated once with the figlet "ANSI Regular" font; the font itself is not a runtime dependency. figlet fonts collection: <http://www.figlet.org/>.

## Runtime dependencies (resolved by npm at install time)

These are listed in `package.json` `dependencies` and pulled in when a user installs `@possibleworlds/tender`. All are MIT, ISC, or Apache-2.0.

| Package | Version range | License |
| --- | --- | --- |
| `chokidar` | ^5.0.0 | MIT |
| `commander` | ^12.0.0 | MIT |
| `express` | ^5.2.1 | MIT |
| `handlebars` | ^4.7.9 | MIT |
| `htmlparser2` | ^12.0.0 | MIT |
| `js-yaml` | ^4.1.1 | MIT |
| `pagedjs` | ^0.4.3 | MIT |
| `puppeteer` | ^24.43.0 | Apache-2.0 |
| `rehype-stringify` | ^10.0.1 | MIT |
| `remark-directive` | ^4.0.0 | MIT |
| `remark-gfm` | ^4.0.1 | MIT |
| `remark-parse` | ^11.0.0 | MIT |
| `remark-rehype` | ^11.1.2 | MIT |
| `retext` | ^9.0.0 | MIT |
| `retext-english` | ^5.0.0 | MIT |
| `retext-smartypants` | ^6.2.0 | MIT |
| `retext-stringify` | ^4.0.0 | MIT |
| `unified` | ^11.0.5 | MIT |
| `unist-util-visit` | ^5.1.0 | MIT |
| `ws` | ^8.20.1 | MIT |
| `yaml` | ^2.6.0 | ISC |
| `zod` | ^4.4.3 | MIT |

Transitive dependencies follow their own licenses; `pnpm licenses list` will give the full tree for a given lockfile.

## Chromium (downloaded by puppeteer on install)

`puppeteer` triggers a one-time download of a pinned Chromium build into `~/.cache/puppeteer/` (or `PUPPETEER_CACHE_DIR`). Chromium is licensed under the BSD 3-Clause license, plus a long list of third-party licenses for its own dependencies — see Chromium's own `LICENSE` and `LICENSES.chromium.html` files in the downloaded distribution.

The downloaded Chromium binary is **not** included in the npm tarball; npm fetches it via puppeteer's `postinstall` script the first time a user installs Tender.

## Paged.js

`pagedjs` (MIT) is the in-browser script Tender loads inside Chromium to paginate the rendered HTML for print. The Paged.js bundle is fetched from npm at install time alongside the rest of the runtime deps; nothing about it is repackaged in the Tender tarball.

## Tender itself

Tender is © Possible Worlds and licensed under the MIT License (see [`LICENSE`](LICENSE)). The `tender` command, the `@possibleworlds/tender` npm package, the `tender-author` Claude skill source under `claude/skills/`, the project templates under `packages/cli/templates/`, and the worked-example fixtures under `packages/core/test/fixtures/open-circle-tags/` are all covered by that license.
