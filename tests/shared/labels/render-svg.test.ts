import { describe, it, expect } from 'vitest';

import { buildLabelSheet } from '../../../shared/labels/layout';
import { resolveMedia } from '../../../shared/labels/media';
import { escapeXml, renderSheetSvg } from '../../../shared/labels/render-svg';
import type { LabelContent } from '../../../shared/labels/types';

const content = (title: string): LabelContent => ({
  title, lines: ['line'], codes: [{ code: '14:0:A-1', caption: 'Check in', tone: 'solid' }],
});

describe('renderSheetSvg', () => {
  it('renders one SVG per page sized in millimetres', () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-l7160'), labels: Array(22).fill(content('T')), symbology: 'code128', humanReadable: true });
    const pages = renderSheetSvg(sheet);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('width="210mm" height="297mm"');
    expect(pages[0]).toContain('viewBox="0 0 210 297"');
    expect(pages[0].match(/class="lt-label"/g)).toHaveLength(21);
  });

  it('escapes text so a label cannot inject markup', () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-l7163'), labels: [content('<script>alert(1)</script>')], symbology: 'code128', humanReadable: false });
    const [page] = renderSheetSvg(sheet);
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;');
  });

  it('marks each symbol with its code for verification', () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-l7163'), labels: [content('T')], symbology: 'qrcode', humanReadable: false });
    expect(renderSheetSvg(sheet)[0]).toContain('data-code="14:0:A-1"');
  });

  it('draws a placeholder for a masked code', () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-cr80'), labels: [{ ...content('T'), masked: true }], symbology: 'code128', humanReadable: true });
    const [page] = renderSheetSvg(sheet);
    expect(page).toContain('Code prints on confirm');
    expect(page).not.toContain('14:0:A-1');
  });

  it('draws outlines only when asked, and cut marks when the sheet has them', () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-cr80'), labels: [content('T')], symbology: 'code128', humanReadable: true, cutMarks: true });
    expect(renderSheetSvg(sheet)[0]).toContain('<line');
    expect(renderSheetSvg(sheet)[0]).not.toContain('stroke="#bbb"');
    expect(renderSheetSvg(sheet, { outlines: true })[0]).toContain('stroke="#bbb"');
  });

  it('escapeXml covers the five XML characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});
