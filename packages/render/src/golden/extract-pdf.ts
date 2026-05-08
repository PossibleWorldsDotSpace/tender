/**
 * Extract a stable, comparable structure from a PDF buffer for golden testing.
 *
 * Goal: catch regressions in page count, page geometry, and text content
 * without being so strict that we break on every Chromium font-rendering
 * tweak. Text is concatenated and trimmed; whitespace is normalized so a
 * subtle line-break shift doesn't fail the test.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfStructure {
  pageCount: number;
  pages: PdfPageStructure[];
}

export interface PdfPageStructure {
  index: number;
  /** Page width × height in PDF user units (typically points: 72/inch). */
  width: number;
  height: number;
  /** Concatenated text on this page with normalized whitespace. */
  text: string;
}

export async function extractPdfStructure(pdfBytes: Uint8Array): Promise<PdfStructure> {
  // pdfjs-dist tries to spin up a worker by default; we run it in-process for
  // simplicity (worker support in Node tests is not worth the complexity).
  const loadingTask = getDocument({
    data: pdfBytes,
    useWorkerFetch: false,
    useSystemFonts: false,
    // Suppress warnings written to console during text extraction.
    verbosity: 0
  });
  const doc = await loadingTask.promise;

  const pages: PdfPageStructure[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string }>;
    const text = items
      .map(it => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({
      index: i,
      width: roundDim(viewport.width),
      height: roundDim(viewport.height),
      text
    });
  }
  await doc.destroy();
  return { pageCount: doc.numPages, pages };
}

function roundDim(n: number): number {
  // Round to 0.1 pt to avoid floating-point noise across runs.
  return Math.round(n * 10) / 10;
}
