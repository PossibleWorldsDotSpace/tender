import { describe, it, expect } from "vitest";
import puppeteer from "puppeteer";
import { startPreviewServer } from "./preview.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "../../../core/test/fixtures/coastal-planet");

describe("preview e2e", () => {
  it("loads all three tabs", async () => {
    const server = await startPreviewServer({ projectDir: fixture, port: 0 });
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: "networkidle0", timeout: 60_000 });

      // Preview tab default
      const previewIframe = await page.$("#preview-iframe");
      expect(previewIframe).not.toBeNull();

      // Switch to Palette
      await page.click('a[href="/palette"]');
      await page.waitForFunction(() => document.querySelectorAll(".tile").length > 0, { timeout: 10_000 });

      // Switch to Help
      await page.click('a[href="/help"]');
      await page.waitForFunction(() => document.querySelector(".help-content") !== null, { timeout: 10_000 });
    } finally {
      await browser.close();
      await server.close();
    }
  }, 120_000);
});
