import { renderSheetSvg } from '../../../shared/labels/render-svg';
import type { LabelSheet } from '../../../shared/labels/types';

const ROOT_ID = 'lt-print-root';
const PAGE_STYLE_ID = 'lt-print-page-size';
export const PRINTING_CLASS = 'lt-printing';

/**
 * Print an issued sheet through the browser at exact size: the pages go in a
 * print-only root beside the app, @page takes the media's size with no
 * margin, and everything else is hidden while the dialog is open.
 */
export function printSheet(sheet: LabelSheet): void {
  clearPrint();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = renderSheetSvg(sheet).join('');
  document.body.appendChild(root);

  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = `@page { size: ${sheet.media.pageWidthMm}mm ${sheet.media.pageHeightMm}mm; margin: 0; }`;
  document.head.appendChild(style);

  document.body.classList.add(PRINTING_CLASS);
  window.addEventListener('afterprint', clearPrint, { once: true });
  window.print();
}

/** Remove the print root and its page size. */
export function clearPrint(): void {
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(PAGE_STYLE_ID)?.remove();
  document.body.classList.remove(PRINTING_CLASS);
}
