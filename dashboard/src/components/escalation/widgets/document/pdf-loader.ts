import type { PDFDocumentProxy } from 'pdfjs-dist';

export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

/**
 * Open a PDF with pdf.js, loaded on first use so the library and its worker
 * reach only pages that show a document. Script evaluation inside the PDF is
 * off; the document paints to canvas and never runs as a page.
 */
export async function openPdf(url: string): Promise<{ doc: PDFDocumentProxy; destroy: () => Promise<void> }> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  if (pdfjs.GlobalWorkerOptions.workerSrc !== worker.default) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const task = pdfjs.getDocument({ url, isEvalSupported: false, withCredentials: false });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}
