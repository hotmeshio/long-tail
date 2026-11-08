import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../../shared/labels/render-svg', () => ({
  renderSheetSvg: () => ['<svg class="lt-print-page"></svg>', '<svg class="lt-print-page"></svg>'],
}));

import { clearPrint, printSheet, PRINTING_CLASS } from '../print-sheet';

const sheet = { media: { pageWidthMm: 210, pageHeightMm: 297 }, pages: [], cutMarks: false, warnings: [] } as any;

afterEach(() => clearPrint());

describe('printSheet', () => {
  it('mounts the pages, sizes the page, and opens the print dialog', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    printSheet(sheet);
    expect(document.querySelectorAll('#lt-print-root .lt-print-page')).toHaveLength(2);
    expect(document.getElementById('lt-print-page-size')?.textContent).toBe('@page { size: 210mm 297mm; margin: 0; }');
    expect(document.body.classList.contains(PRINTING_CLASS)).toBe(true);
    expect(print).toHaveBeenCalledOnce();
  });

  it('cleans up after printing', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    printSheet(sheet);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('lt-print-root')).toBeNull();
    expect(document.getElementById('lt-print-page-size')).toBeNull();
    expect(document.body.classList.contains(PRINTING_CLASS)).toBe(false);
  });

  it('replaces a sheet left from an earlier print', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    printSheet(sheet);
    printSheet(sheet);
    expect(document.querySelectorAll('#lt-print-root')).toHaveLength(1);
  });
});
