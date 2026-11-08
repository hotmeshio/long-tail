import { describe, it, expect } from 'vitest';

import { buildLabelSheet, cutMarkSegments, LabelLayoutError } from '../../../shared/labels/layout';
import { resolveMedia } from '../../../shared/labels/media';
import type { LabelContent } from '../../../shared/labels/types';

const label = (n: number): LabelContent => ({
  title: `A-${n}`, lines: [], codes: [{ code: `14:0:A-${n}`, caption: 'Check in', tone: 'solid' }],
});
const labels = (count: number) => Array.from({ length: count }, (_, i) => label(i + 1));
const base = { symbology: 'code128' as const, humanReadable: true };

describe('buildLabelSheet', () => {
  it('40 labels on A4 L7160 fill two pages', () => {
    const sheet = buildLabelSheet({ ...base, media: resolveMedia('a4-l7160'), labels: labels(40) });
    expect(sheet.pages.map((p) => p.labels.length)).toEqual([21, 19]);
  });

  it('start position 7 skips the first six slots of page one only', () => {
    const sheet = buildLabelSheet({ ...base, media: resolveMedia('a4-l7160'), labels: labels(40), startPosition: 7 });
    expect(sheet.pages[0].labels[0].slot).toBe(6);
    expect(sheet.pages[0].labels).toHaveLength(15);
    expect(sheet.pages[1].labels[0].slot).toBe(0);
    expect(sheet.pages.flatMap((p) => p.labels)).toHaveLength(40);
  });

  it('prints copies of each label together', () => {
    const sheet = buildLabelSheet({ ...base, media: resolveMedia('a4-l7160'), labels: labels(2), copies: 3 });
    expect(sheet.pages[0].labels.map((l) => l.index)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('one per page puts each label in the start slot of its own page', () => {
    const sheet = buildLabelSheet({ ...base, media: resolveMedia('a4-l7163'), labels: labels(3), onePerPage: true, startPosition: 2 });
    expect(sheet.pages).toHaveLength(3);
    expect(sheet.pages.map((p) => p.labels.map((l) => l.slot))).toEqual([[1], [1], [1]]);
  });

  it('a thermal roll prints one label per page', () => {
    const sheet = buildLabelSheet({ ...base, media: resolveMedia('thermal-4x2'), labels: labels(3) });
    expect(sheet.pages.map((p) => p.labels.length)).toEqual([1, 1, 1]);
  });

  it('carries label warnings with their input index', () => {
    const sheet = buildLabelSheet({ ...base, media: resolveMedia('a4-l7651'), labels: [label(1), { ...label(2), title: 'Y'.repeat(300) }] });
    expect(sheet.warnings.some((w) => w.index === 1 && w.kind === 'overflow')).toBe(true);
  });

  it('refuses a start position past the sheet and out-of-range copies', () => {
    const media = resolveMedia('a4-l7160');
    expect(() => buildLabelSheet({ ...base, media, labels: labels(1), startPosition: 22 })).toThrow(LabelLayoutError);
    expect(() => buildLabelSheet({ ...base, media, labels: labels(1), copies: 0 })).toThrow(/copies/);
  });
});

describe('cutMarkSegments', () => {
  it('draws ticks outside the card grid, on the page', () => {
    const media = resolveMedia('a4-cr80');
    const segments = cutMarkSegments(media);
    expect(segments.length).toBeGreaterThan(0);
    for (const [x1, y1, x2, y2] of segments) {
      for (const x of [x1, x2]) expect(x).toBeGreaterThanOrEqual(0);
      for (const y of [y1, y2]) expect(y).toBeLessThanOrEqual(media.pageHeightMm);
    }
  });
});
