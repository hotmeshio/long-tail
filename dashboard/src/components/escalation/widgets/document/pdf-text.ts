import type { PDFDocumentProxy, PDFPageProxy } from './pdf-loader';
import { findQuote, type QuoteMatch, type TextRun } from './find-quote';

/** A page's text runs from its text layer; empty for a scanned page that has none. */
export async function pageRuns(page: PDFPageProxy): Promise<TextRun[]> {
  const content = await page.getTextContent();
  return content.items.flatMap((item) =>
    'str' in item ? [{ str: item.str, transform: item.transform as number[], width: item.width, height: item.height }] : [],
  );
}

/** The first page holding the quote, searching `startAt` first, or null when no page does. */
export async function findQuotePage(doc: PDFDocumentProxy, quote: string, startAt?: number): Promise<number | null> {
  const order = Array.from({ length: doc.numPages }, (_, i) => i + 1);
  if (startAt && startAt >= 1 && startAt <= doc.numPages) order.sort((a, b) => (a === startAt ? -1 : b === startAt ? 1 : a - b));
  for (const n of order) {
    const runs = await pageRuns(await doc.getPage(n));
    if (findQuote(runs, quote)) return n;
  }
  return null;
}

export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The painted rectangles of a quote on a page, in the page's current viewport. */
export function highlightRects(
  runs: TextRun[],
  matches: QuoteMatch[],
  convert: (rect: [number, number, number, number]) => number[],
): HighlightRect[] {
  return matches.map(({ runIndex, from, to }) => {
    const run = runs[runIndex];
    const [x, y] = [run.transform[4], run.transform[5]];
    const [x1, y1, x2, y2] = convert([x + run.width * from, y, x + run.width * to, y + run.height]);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  });
}
