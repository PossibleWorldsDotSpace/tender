import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { inlineAssets, inlineFonts } from "./inline-assets.js";

const require = createRequire(import.meta.url);
// pagedjs's package.json exports field doesn't expose dist/, so we resolve the
// package's main entry then walk up to the package root and join dist/.
const pagedJsPkgEntry = require.resolve("pagedjs");
// Entry resolves to .../pagedjs/lib/index.cjs (or src/index.js); package root is two levels up.
const pagedJsPkgRoot = dirname(dirname(pagedJsPkgEntry));
const pagedJsPath = join(pagedJsPkgRoot, "dist", "paged.polyfill.js");

export interface RenderInput {
  html: string;
  projectCss: string;
  /**
   * Concatenated <style> blocks from every .tender component, served in the
   * cascade between _project.css and styles.css. May be empty.
   */
  componentsCss?: string;
  stylesCss: string;
  projectDir: string;
  /**
   * Maximum time to wait for Paged.js to finish paginating, in ms. Defaults to
   * 60_000. Long documents on slower hardware may legitimately need more.
   */
  timeoutMs?: number;
  /**
   * Page-box dimensions as CSS-dimension strings (e.g. "210mm", "297mm"),
   * passed straight to Chromium's `page.pdf()`. Required for correct PDF page
   * size: Paged.js consumes the `@page { size }` rule into its own
   * `--pagedjs-*` properties, so Chromium's `preferCSSPageSize` has nothing
   * left to read and the PDF would otherwise default to US Letter.
   *
   * When omitted, `renderPdf` falls back to `preferCSSPageSize: true` (the
   * old behaviour) — fine for tests that don't care about exact page size.
   * `buildProject` always sets these.
   */
  pageWidth?: string;
  pageHeight?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

async function setupPage(input: RenderInput, browser: Browser): Promise<Page> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Embed @font-face files as data URIs before Paged.js sees the CSS. Paged.js'
  // polisher otherwise rewrites a relative `url(assets/fonts/x.woff2)` to an
  // absolute `file://` path, which works only when the rendered HTML is opened
  // from disk on the same machine and 404s when `tender preview` serves the
  // page over http. Done here (not in compose) because resolving the bytes
  // needs filesystem access.
  const projectCss = await inlineFonts(input.projectCss, input.projectDir);
  const componentsCss = await inlineFonts(input.componentsCss ?? "", input.projectDir);
  const stylesCss = await inlineFonts(input.stylesCss, input.projectDir);
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", req => {
    const url = req.url();
    if (url.endsWith("/_project.css")) {
      req.respond({ status: 200, contentType: "text/css", body: projectCss });
      return;
    }
    if (url.endsWith("/_components.css")) {
      req.respond({ status: 200, contentType: "text/css", body: componentsCss });
      return;
    }
    if (url.endsWith("/styles.css")) {
      req.respond({ status: 200, contentType: "text/css", body: stylesCss });
      return;
    }
    req.continue();
  });
  // Set the page to the project dir so relative asset paths resolve.
  // Use about:blank if projectDir is unusable; setContent will replace anyway.
  try {
    await page.goto(`file://${input.projectDir}/`, { waitUntil: "domcontentloaded" });
  } catch {
    await page.goto("about:blank");
  }
  await page.setContent(input.html, { waitUntil: "domcontentloaded" });

  // Inject Paged.js polyfill with auto:false, then explicitly run preview().
  // The polyfill's factory() returns a Previewer instance which it assigns to
  // window.PagedPolyfill. Previewer.preview(content, stylesheets, renderTo)
  // returns a promise that resolves to the rendered flow.
  const pagedJsSrc = await readFile(pagedJsPath, "utf8");
  await page.evaluate(
    (src: string, projectCss: string, componentsCss: string, stylesCss: string, ms: number) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(
        `Paged.js render exceeded ${ms}ms. ` +
        `If your document is long, try a higher render.timeout-ms in project.yaml ` +
        `or pass --timeout to the CLI.`
      )), ms);
      try {
        // Disable auto-render before injecting the script.
        (window as unknown as { PagedConfig: Record<string, unknown> }).PagedConfig = { auto: false };
        const script = document.createElement("script");
        script.textContent = src;
        document.head.appendChild(script);
        const previewer = (window as unknown as {
          PagedPolyfill: {
            preview: (c: string, s: Array<Record<string, string>>, r: HTMLElement) => Promise<unknown>;
          };
        }).PagedPolyfill;
        const bodyHtml = document.body.innerHTML;
        document.body.innerHTML = "";
        // Pass each stylesheet to Paged.js' polisher as { url: cssText } so it
        // receives the @page and break rules directly instead of refetching
        // <link>s that would have been removed during preview. Order matches
        // the cascade declared in composeDocument: project → components → user.
        const sheets: Array<Record<string, string>> = [];
        if (projectCss) sheets.push({ "_project.css": projectCss });
        if (componentsCss) sheets.push({ "_components.css": componentsCss });
        if (stylesCss) sheets.push({ "styles.css": stylesCss });
        previewer.preview(bodyHtml, sheets, document.body)
          .then(() => { clearTimeout(timer); resolve(); })
          .catch((e: unknown) => { clearTimeout(timer); reject(e as Error); });
      } catch (e) {
        clearTimeout(timer);
        reject(e as Error);
      }
    }),
    pagedJsSrc,
    projectCss,
    componentsCss,
    stylesCss,
    timeoutMs
  );
  return page;
}

/**
 * Build the `page.pdf()` options. When the caller supplied explicit page
 * dimensions (always, from `buildProject`), pass them through with zero
 * margins — Paged.js has already baked the page margin into the
 * `.pagedjs_pagebox` as internal whitespace, so a non-zero `page.pdf({ margin })`
 * would double it. When dimensions are absent, fall back to Chromium's
 * `preferCSSPageSize` (the historical behaviour).
 */
function pdfOptions(input: RenderInput): Parameters<Page["pdf"]>[0] {
  if (input.pageWidth && input.pageHeight) {
    return {
      printBackground: true,
      width: input.pageWidth,
      height: input.pageHeight,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    };
  }
  return { printBackground: true, preferCSSPageSize: true };
}

// Paged.js was injected and run server-side to paginate the content. The
// resulting HTML contains the (very large) Paged.js source as an inline
// <script>. Without removal, that script auto-runs again when the HTML is
// loaded in any browser, re-paginating the already-paginated DOM into a
// nested mess. We strip it here for both standalone export and preview.
function stripPagedJsScript(html: string): string {
  return html.replace(
    /<script\b[^>]*>[\s\S]*?@license Paged\.js[\s\S]*?<\/script>/g,
    ""
  );
}

/**
 * A persistent render context owning a single Chromium browser instance.
 * Reuse across many renders saves the 1-3s cold-start the preview server
 * pays on every save.
 *
 * Each render creates a fresh page and closes it on completion, so state
 * (interception handlers, DOM) is isolated between renders. The browser
 * itself is reused.
 */
export interface RenderSession {
  renderHtml(input: RenderInput): Promise<string>;
  renderPdf(input: RenderInput): Promise<Buffer>;
  close(): Promise<void>;
}

async function launchBrowser(): Promise<Browser> {
  // --no-sandbox: required on Ubuntu hosts that disable unprivileged user
  // namespaces. See README "Security considerations".
  return puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
}

export async function createRenderSession(): Promise<RenderSession> {
  let browser: Browser = await launchBrowser();
  let closed = false;

  async function ensureBrowser(): Promise<Browser> {
    // If the browser crashed (e.g. OOM on a huge doc), `connected` flips
    // false; relaunch transparently for the next render.
    if (!browser.connected && !closed) {
      browser = await launchBrowser();
    }
    return browser;
  }

  return {
    async renderHtml(input) {
      if (closed) throw new Error("render session is closed");
      const b = await ensureBrowser();
      const page = await setupPage(input, b);
      try {
        const html = await page.content();
        return await inlineAssets(stripPagedJsScript(html), input.projectDir);
      } finally {
        await page.close().catch(() => { /* page may already be gone if browser crashed */ });
      }
    },
    async renderPdf(input) {
      if (closed) throw new Error("render session is closed");
      const b = await ensureBrowser();
      const page = await setupPage(input, b);
      try {
        const pdf = await page.pdf(pdfOptions(input));
        return Buffer.from(pdf);
      } finally {
        await page.close().catch(() => { /* see above */ });
      }
    },
    async close() {
      closed = true;
      await browser.close().catch(() => { /* already closed */ });
    }
  };
}

/**
 * One-shot render: launches a browser, renders, closes the browser. Suitable
 * for `tender build` where the cost is paid once. For `tender preview` (many
 * renders in one session) prefer `createRenderSession`.
 */
export async function renderHtml(input: RenderInput): Promise<string> {
  const session = await createRenderSession();
  try {
    return await session.renderHtml(input);
  } finally {
    await session.close();
  }
}

export async function renderPdf(input: RenderInput): Promise<Buffer> {
  const session = await createRenderSession();
  try {
    return await session.renderPdf(input);
  } finally {
    await session.close();
  }
}
