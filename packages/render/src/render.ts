import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { inlineAssets } from "./inline-assets.js";

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
  stylesCss: string;
  projectDir: string;
}

async function setupPage(input: RenderInput, browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", req => {
    const url = req.url();
    if (url.endsWith("/_project.css")) {
      req.respond({ status: 200, contentType: "text/css", body: input.projectCss });
      return;
    }
    if (url.endsWith("/styles.css")) {
      req.respond({ status: 200, contentType: "text/css", body: input.stylesCss });
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
    (src: string, projectCss: string, stylesCss: string) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("paged.js render timeout")), 60_000);
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
        // Pass project CSS (and any user styles.css) directly as
        // { url: cssText } objects so Paged.js' polisher receives the @page
        // and break-before rules instead of trying to refetch <link>s that
        // would have been removed during the preview phase.
        const sheets: Array<Record<string, string>> = [];
        if (projectCss) sheets.push({ "_project.css": projectCss });
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
    input.projectCss,
    input.stylesCss
  );
  return page;
}

export async function renderHtml(input: RenderInput): Promise<string> {
  // --no-sandbox: required on Ubuntu hosts that disable unprivileged user
  // namespaces; acceptable here since we only render fixtures we control.
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await setupPage(input, browser);
    const html = await page.content();
    return await inlineAssets(stripPagedJsScript(html), input.projectDir);
  } finally {
    await browser.close();
  }
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

export async function renderPdf(input: RenderInput): Promise<Buffer> {
  // --no-sandbox: required on Ubuntu hosts that disable unprivileged user
  // namespaces; acceptable here since we only render fixtures we control.
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await setupPage(input, browser);
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
