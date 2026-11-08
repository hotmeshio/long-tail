import { describe, it, expect } from 'vitest';

import { layoutLabelContent } from '../../../shared/labels/label-content';
import type { LabelContent, LabelSymbolElement, LabelTextElement } from '../../../shared/labels/types';

const opts = { symbology: 'code128' as const, humanReadable: true, minModuleMm: 0.25 };
const twoCode: LabelContent = {
  title: 'A-3',
  lines: ['Acme North'],
  codes: [
    { code: '14:0:A-3', caption: 'Check in', tone: 'solid' },
    { code: '14:1:A-3', caption: 'Check out', tone: 'outline' },
  ],
};

const symbols = (els: ReturnType<typeof layoutLabelContent>['elements']) =>
  els.filter((e): e is LabelSymbolElement => e.kind === 'symbol');

describe('layoutLabelContent', () => {
  it('draws the title, line, and a band plus symbol per code', () => {
    const { elements, warnings } = layoutLabelContent(twoCode, 99.1, 67.7, opts);
    const texts = elements.filter((e): e is LabelTextElement => e.kind === 'text').map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(['A-3', 'Acme North', 'Check in', 'Check out', '14:0:A-3']));
    expect(symbols(elements).map((s) => s.data)).toEqual(['14:0:A-3', '14:1:A-3']);
    expect(warnings).toEqual([]);
  });

  it('fills a solid band and prints its caption inverse; outlines the other', () => {
    const { elements } = layoutLabelContent(twoCode, 99.1, 67.7, opts);
    const rects = elements.filter((e) => e.kind === 'rect');
    expect(rects.map((r) => (r as { fill: boolean }).fill)).toEqual([true, false]);
    const caption = elements.find((e) => e.kind === 'text' && e.text === 'Check in') as LabelTextElement;
    expect(caption.inverse).toBe(true);
  });

  it('keeps every element inside the label box', () => {
    const { elements } = layoutLabelContent(twoCode, 63.5, 38.1, opts);
    for (const el of elements) {
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.x + el.w).toBeLessThanOrEqual(63.5 + 1e-6);
    }
  });

  it('warns when bars would print below the scanner minimum', () => {
    const { warnings } = layoutLabelContent(twoCode, 20, 12, opts);
    expect(warnings.map((w) => w.kind)).toContain('scale');
  });

  it('shortens text too long for the label and says so', () => {
    const { warnings } = layoutLabelContent({ ...twoCode, title: 'X'.repeat(400) }, 38.1, 21.2, opts);
    expect(warnings.map((w) => w.kind)).toContain('overflow');
  });

  it('masks codes: same geometry, no data, no readable code', () => {
    const plain = layoutLabelContent(twoCode, 99.1, 67.7, opts);
    const masked = layoutLabelContent({ ...twoCode, masked: true }, 99.1, 67.7, opts);
    expect(symbols(masked.elements).map((s) => [s.data, s.path, s.masked])).toEqual([['', '', true], ['', '', true]]);
    expect(symbols(masked.elements).map((s) => s.w)).toEqual(symbols(plain.elements).map((s) => s.w));
    expect(JSON.stringify(masked.elements)).not.toContain('14:0:A-3');
  });

  it('reports an unencodable code instead of throwing', () => {
    const { warnings } = layoutLabelContent({ lines: [], codes: [{ code: 'é', caption: '', tone: 'plain' }] }, 50, 30, opts);
    expect(warnings.map((w) => w.kind)).toEqual(['unencodable']);
  });
});
