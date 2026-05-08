# Tender Preview UI — Wave A Design

> Wave A scope: tabbed SPA shell for `tender preview` with Preview, Palette, and Help tabs. Read-only — no visual builder. Wave B (visual builder) is a separate design later.

This design extends the existing preview server. The CLI (`tender preview`), core build pipeline, and PDF/HTML export are unchanged.

## Goal

Turn the single Paged.js preview page into a multi-tab UI:

- **Preview** — the existing live-reloading rendered output.
- **Palette** — visual gallery of project-defined components, templates, and a typography specimen, each rendered with placeholder content and project styles.
- **Help** — the user guide rendered inline.

Provide the foundation for an eventual visual builder (Wave B) without committing to its scope yet.

## Non-goals (Wave A)

- Editing components, templates, or styles through the UI. Tiles are read-only.
- Search, filter, or grouping beyond the three top-level palette sections.
- Pixel-perfect mobile / small-window layout (the preview iframe is a fixed A4 sheet; the SPA is best on a desktop-sized window).
- Authentication or multi-user. Preview server is local/Tailscale; same model as today.

## Architecture

### New package: `@tender/preview-ui`

A Solid + Vite SPA. Builds to a static bundle that the existing CLI preview server serves.

```
packages/
  core/             (unchanged)
  render/           (unchanged)
  cli/              (changes: serves preview-ui bundle + new API endpoints)
  preview-ui/       (NEW)
    src/
      App.tsx              (router + tab shell)
      tabs/
        Preview.tsx        (<iframe src="/_preview">)
        Palette.tsx
        Help.tsx
      components/
        Tile.tsx           (Shadow-DOM-isolated render container)
        TabBar.tsx
        ErrorBanner.tsx
      api.ts               (typed fetch + WS client)
      styles.css           (SPA chrome only — not the project's styles)
      assets/
        builtin-user-guide.md  (bundled fallback)
    index.html
    vite.config.ts
    package.json
```

**Why Solid + Vite.** Smallest mainstream framework runtime (~7KB), fine-grained reactivity, excellent TypeScript support. Vite handles the dev server / bundle. Sets up a real component model that Wave B (builder) will need without committing React-scale weight.

### Server changes (`@tender/cli/src/commands/preview.ts`)

Routes:

| Route | Returns |
|---|---|
| `GET /` | The SPA shell (`@tender/preview-ui/dist/index.html`). |
| `GET /_ui/*` | SPA static assets (JS bundle, CSS, fonts). |
| `GET /_preview` | The existing Paged.js-rendered HTML — **unchanged from today**, just a new route. |
| `GET /assets/*` | Project assets (existing). |
| `GET /_api/palette` | JSON: components, templates, typography specimen (see below). |
| `GET /_api/help` | JSON: `{ html, source }` — user guide rendered as HTML. |
| `GET /_api/styles.css` | Project's `styles.css` (used by Palette tiles). |
| `GET /_api/_project.css` | Generated `_project.css` (same). |
| `WS /_tender` | File-change notifications. |

The `WS /_tender` payload changes from a bare `"reload"` string to a typed JSON message:

```typescript
type WsMessage =
  | { kind: "content" }     // content.md changed
  | { kind: "project" }     // project.yaml changed
  | { kind: "styles" }      // styles.css changed
  | { kind: "help" }        // docs/user-guide.md changed
  | { kind: "assets" }      // anything in assets/
  | { kind: "error", message: string }; // build error from project.yaml/content.md
```

The SPA decides what to re-fetch based on the kind:

| WS kind | Preview | Palette | Help |
|---|---|---|---|
| content | reload iframe | — | — |
| project | reload iframe | re-fetch `/_api/palette` | — |
| styles | reload iframe | re-fetch `/_api/styles.css` (live-replace `<style>`) | — |
| assets | reload iframe | — | — |
| help | — | — | re-fetch `/_api/help` |
| error | show overlay | show error banner | — |

### Preview tab

A single `<iframe src="/_preview">`. Paged.js needs its own DOM and stylesheets; embedding it in the SPA's DOM would conflict. The iframe is a real isolated browsing context.

Live reload: when a `content`/`project`/`styles`/`assets` WS message arrives, the SPA calls `iframeEl.contentWindow.location.reload()`. The existing margin guides, drop-shadows, and page-numbering chrome stay inside the iframe (they live in `injectPreviewExtras` already).

### Palette tab

Three vertically-stacked sections:

1. **Components** — one tile per declared component.
2. **Templates** — one tile per declared template.
3. **Typography specimen** — fixed set of tiles for headings, paragraphs, lists, etc.

Tile structure (HTML/JSX, not literal):

```jsx
<article class="tile">
  <header>
    <h3>callout</h3>
    <dl class="meta">
      <dt>tag</dt> <dd>aside</dd>
      <dt>class</dt> <dd>callout</dd>
      <dt>attrs</dt> <dd>variant</dd>
    </dl>
  </header>

  <ShadowRoot>
    {renderedHtml}                 {/* with project styles applied */}
  </ShadowRoot>

  <footer>
    <pre><code>{snippet}</code></pre>
    <button onClick={copy}>📋</button>
  </footer>
</article>
```

**Shadow DOM isolation.** Each tile attaches a shadow root and injects:

- `<link rel="stylesheet" href="/_api/_project.css">`
- `<link rel="stylesheet" href="/_api/styles.css">`
- The pre-computed rendered HTML from `/_api/palette`.

Fonts are an exception: `@font-face` rules declared inside a shadow root don't load globally. The SPA hoists them to the document head once on mount by parsing the project CSS for `@font-face` blocks and re-emitting them in `<head>`.

**Variants.** If a component/template declares `palette.variants`, render each variant as an additional `<ShadowRoot>` block within the same tile, separated by a divider.

**Copy snippet.** Click `📋` → `navigator.clipboard.writeText(snippet)` → toast: "Copied". Snippet is the source-level invocation: `:::callout{variant=warning}\n…body…\n:::` for components; `::::page{template=cover}` for the page template.

### `/_api/palette` response shape

```typescript
type PaletteResponse = {
  components: PaletteEntry[];
  templates: PaletteEntry[];
  typography: TypographySpecimen[];
};

type PaletteEntry = {
  name: string;
  kind: "component" | "template";
  meta: {
    tag?: string;
    class?: string;
    attrs?: string[];
    params?: string[];
    slots?: string[];
    inline?: boolean;
  };
  renders: Render[];          // base + variants
};

type Render = {
  label?: string;             // "default" / "variant: info" / etc.
  html: string;               // pre-rendered, ready for shadow-root insertion
  snippet: string;            // source-level invocation
};

type TypographySpecimen = {
  id: string;                 // "h1" | "p" | "ul" | ...
  label: string;
  html: string;
};
```

The server pre-renders the HTML on the way out — same parser+template pipeline as the build, just with placeholder content. This keeps the SPA simple (no template engine in the browser).

### Placeholder content rules

When computing renders for a component/template:

1. **If `palette` block is declared** (in `project.yaml`), use it.
2. **Else, compute defaults:**
   - For each declared `attr`/`param`: empty string, or `"sample"` if non-empty needed.
   - For each declared `slot` and the implicit `body`: a generic English sentence appropriate to the slot (1–3 sentences). **Not lorem ipsum** — real readable English so users can judge typography. The server has a small fixed pool of placeholder sentences.

The `palette` block schema:

```yaml
components:
  callout:
    tag: aside
    class: callout
    attrs: [variant]
    palette:                       # optional
      attrs: { variant: warning }  # base render's attr values
      body: |                       # base render's body
        Watch your step — this is what a callout looks like.
      variants:                    # additional renders
        - { attrs: { variant: info }, body: "Info variant." }
        - { attrs: { variant: note }, body: "Note variant." }
```

`palette` is metadata: it never affects PDF/HTML build output. Schema validates it; build ignores it.

### Typography specimen

Fixed set of samples rendered with project CSS — same Shadow DOM mechanism as component tiles. Server returns:

```json
{
  "typography": [
    { "id": "h1", "label": "Heading 1", "html": "<h1>The quick brown fox</h1>" },
    { "id": "h2", "label": "Heading 2", "html": "<h2>The quick brown fox</h2>" },
    { "id": "h3", "label": "Heading 3", "html": "<h3>The quick brown fox</h3>" },
    { "id": "h4", "label": "Heading 4", "html": "<h4>The quick brown fox</h4>" },
    { "id": "p",  "label": "Body paragraph", "html": "<p>...with <em>em</em>, <strong>strong</strong>, <code>code</code>, and a <a href='#'>link</a>...</p>" },
    { "id": "ul", "label": "Unordered list", "html": "<ul>...</ul>" },
    { "id": "ol", "label": "Ordered list", "html": "<ol>...</ol>" },
    { "id": "blockquote", "label": "Blockquote", "html": "<blockquote>...</blockquote>" },
    { "id": "pre", "label": "Code block", "html": "<pre><code>...</code></pre>" },
    { "id": "hr", "label": "Horizontal rule", "html": "<hr>" }
  ]
}
```

The SPA annotates each tile with computed style info read via `getComputedStyle` after render — font size, line height, font family — shown as a small caption below the rendered sample. Caption updates whenever the project CSS reloads.

### Help tab

`GET /_api/help` returns:

```typescript
{
  html: string;                  // rendered Markdown
  source: "project" | "builtin"; // for the "showing built-in" notice
}
```

Server logic:

1. Look for `docs/user-guide.md` in the project directory.
2. If absent, use the built-in copy from `@tender/preview-ui/src/assets/builtin-user-guide.md`.
3. Render via `unified` + `remark-parse` + `remark-rehype` + `rehype-stringify`. CommonMark only — no directives, since this is general documentation.
4. Return JSON.

The SPA renders the HTML inside a styled container (handwritten CSS in `preview-ui/src/styles.css`, no Tailwind). When `source === "builtin"`, show a small banner: "Using the bundled user guide. Place a customised copy at `docs/user-guide.md` to override."

Live reload: WS `{ kind: "help" }` triggers a re-fetch only if the project has its own `docs/user-guide.md`.

### Routing

Solid Router. Routes:

- `/` → Preview tab
- `/palette` → Palette tab
- `/help` → Help tab

URL changes update the active tab; reload preserves the tab; deep-linkable.

The Preview iframe is mounted permanently (not unmounted when switching tabs) — re-mounting would force Paged.js to re-render, costing seconds. CSS hides it on non-Preview tabs.

## Error handling

| Source | Manifestation |
|---|---|
| Schema parse error in `project.yaml` | Palette tab: red banner with the message + line. Preview iframe: error overlay (existing). |
| Malformed Handlebars in a template | Palette tab: that single tile becomes an error tile (others render). |
| Missing `docs/user-guide.md` AND missing built-in | Help tab: "Couldn't load user guide" with a link to the GitHub repo. |
| `/_api/palette` returns 5xx | Palette tab: full-tab error banner with retry button. |
| WebSocket disconnect | SPA shows a "preview disconnected — retrying" pill in the corner; reconnect with backoff. |

## Build & dev workflow

`@tender/preview-ui` ships with two scripts:

- `pnpm --filter @tender/preview-ui dev` — Vite dev server on a separate port (e.g. 5173) with HMR. Used while developing the UI itself; proxies API calls to the live `tender preview` instance.
- `pnpm --filter @tender/preview-ui build` — outputs `dist/` consumed by the CLI.

`@tender/cli`'s build script gains a step: build `@tender/preview-ui` first (or use `pnpm -r build` topological ordering — preview-ui already declares no dependency on cli, so order works out).

In production / installed CLI, the SPA bundle is served from disk; no Vite involved at runtime.

## Testing

| Layer | What gets tested |
|---|---|
| `preview-ui` unit (Vitest + jsdom) | Tile component renders title + meta + shadow root contents; tab routing; WS message dispatch. |
| `cli` integration | New endpoints (`/_api/palette`, `/_api/help`, `/_api/styles.css`) return well-formed responses for the existing fixtures (hello, components, coastal-planet). |
| `cli` integration (Playwright or Puppeteer) | End-to-end: start preview server with a fixture, load `/`, verify all three tabs render without errors, verify selective reload (touch `content.md`, expect Preview iframe to reload but Palette tiles unchanged). |

E2E tests are gated to a single fixture (coastal-planet) since they're slow.

## Migration

`tender preview` users today land on a page with the Paged.js output directly at `/`. After this change, `/` is the SPA shell with the Preview tab as the default route — same content, behind a tab. Anyone bookmarking `/` continues to work; users wanting the bare iframe can use `/_preview` directly.

## Out of scope (Wave B and later)

- **Visual builder** — the editing UI for components/templates/styles. Wave B.
- **Multi-window / multi-tab support** in the SPA shell.
- **Document outline / TOC** as a 4th tab.
- **Diff view** of unsaved changes.
- **Keyboard shortcuts** beyond the basics.
- **Theming** the SPA chrome itself (light/dark UI; not the same as light/dark output).

These are tracked here as roadmap markers; design happens when the work is closer.
