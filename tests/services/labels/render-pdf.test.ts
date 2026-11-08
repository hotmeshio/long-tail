import { describe, it, expect, afterEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { renderSheetPdf, registerLabelFonts, scalePath } from '../../../services/labels/render-pdf';
import { buildLabelSheet } from '../../../shared/labels/layout';
import { resolveMedia } from '../../../shared/labels/media';
import type { LabelContent } from '../../../shared/labels/types';

const label = (title: string): LabelContent => ({
  title, lines: ['Acme North'], codes: [{ code: '14:0:A-1', caption: 'Check in', tone: 'solid' }],
});

afterEach(() => registerLabelFonts(null));

describe('renderSheetPdf', () => {
  it('writes one page per sheet page at the exact A4 size', async () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-l7160'), labels: Array(25).fill(label('T')), symbology: 'code128', humanReadable: true });
    const bytes = await renderSheetPdf(sheet);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  it('draws characters Helvetica lacks as "?" instead of failing', async () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-l7163'), labels: [label('Zoë 李')], symbology: 'qrcode', humanReadable: false });
    await expect(renderSheetPdf(sheet)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('renders masked labels and cut marks', async () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-cr80'), labels: [{ ...label('T'), masked: true }], symbology: 'code128', humanReadable: true, cutMarks: true });
    const doc = await PDFDocument.load(await renderSheetPdf(sheet));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('scalePath', () => {
  it('scales x by sx and y by sy', () => {
    expect(scalePath('M2 0h3v1h-3z', 0.5, 10)).toBe('M1 0h1.5v10h-1.5z');
    expect(scalePath('M1 2h1v1h-1z', 2, 2)).toBe('M2 4h2v2h-2z');
  });
});
