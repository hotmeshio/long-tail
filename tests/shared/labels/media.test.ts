import { describe, it, expect } from 'vitest';

import {
  DEFAULT_LABEL_MEDIA_ID,
  LABEL_MEDIA,
  LabelMediaError,
  assertValidMedia,
  resolveMedia,
  slotOrigin,
  slotsPerPage,
} from '../../../shared/labels/media';

describe('label media presets', () => {
  it('every preset fits its page', () => {
    for (const media of LABEL_MEDIA) expect(() => assertValidMedia(media)).not.toThrow();
  });

  it('ids are unique and the default exists', () => {
    const ids = LABEL_MEDIA.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_LABEL_MEDIA_ID);
  });

  it('A4 L7160 holds 21 labels at the published pitch', () => {
    const media = resolveMedia('a4-l7160');
    expect(media.pageWidthMm).toBe(210);
    expect(slotsPerPage(media)).toBe(21);
    expect(slotOrigin(media, 1).x - slotOrigin(media, 0).x).toBeCloseTo(66.04, 2);
    expect(slotOrigin(media, 3)).toEqual({ x: 7.25, y: 15.15 + 38.1 });
  });

  it('thermal media carry a dpi', () => {
    expect(resolveMedia('thermal-4x2').dpi).toBe(203);
  });
});

describe('resolveMedia', () => {
  const custom = {
    id: 'custom', name: 'Custom', family: 'sheet' as const, pageWidthMm: 100, pageHeightMm: 100,
    columns: 2, rows: 2, labelWidthMm: 45, labelHeightMm: 45, marginTopMm: 2, marginLeftMm: 2,
    gutterXMm: 2, gutterYMm: 2, cornerRadiusMm: 0, minModuleMm: 0.25,
  };

  it('accepts a custom grid that fits', () => {
    expect(resolveMedia(custom).columns).toBe(2);
  });

  it('refuses an unknown id', () => {
    expect(() => resolveMedia('nope')).toThrow(LabelMediaError);
  });

  it('refuses labels past the page edge, zero sizes and negative gutters', () => {
    expect(() => resolveMedia({ ...custom, labelWidthMm: 60 })).toThrow(/past the page edge/);
    expect(() => resolveMedia({ ...custom, labelHeightMm: 0 })).toThrow(/positive/);
    expect(() => resolveMedia({ ...custom, gutterXMm: -1 })).toThrow(/negative/);
  });

  it('refuses thermal media without a dpi', () => {
    expect(() => resolveMedia({ ...custom, family: 'thermal', columns: 1, rows: 1 })).toThrow(/dpi/);
  });

  it('resolves host presets', () => {
    expect(resolveMedia('custom', [custom]).id).toBe('custom');
  });
});
