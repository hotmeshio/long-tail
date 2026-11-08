// Label media: sheet stock for office printers and thermal rolls. Geometry is
// in millimetres, from the stock manufacturers' published templates.

import type { LabelMedia } from './types';

const A4 = { pageWidthMm: 210, pageHeightMm: 297 };
const LETTER = { pageWidthMm: 215.9, pageHeightMm: 279.4 };
const IN = 25.4;
const SHEET_MIN_MODULE_MM = 0.25;
const THERMAL_MIN_MODULE_MM = 0.25;
const THERMAL_DPI = 203;

const CR80_W = 85.6;
const CR80_H = 53.98;
const CARD_GUTTER = 6;

function sheet(m: Omit<LabelMedia, 'family' | 'minModuleMm' | 'pageWidthMm' | 'pageHeightMm'>, page: typeof A4): LabelMedia {
  return { family: 'sheet', minModuleMm: SHEET_MIN_MODULE_MM, ...page, ...m };
}

/** Cards centred on the page with cut gutters between them. */
function cards(id: string, name: string, page: typeof A4, columns: number, rows: number): LabelMedia {
  const marginLeftMm = (page.pageWidthMm - columns * CR80_W - (columns - 1) * CARD_GUTTER) / 2;
  const marginTopMm = (page.pageHeightMm - rows * CR80_H - (rows - 1) * CARD_GUTTER) / 2;
  return sheet({
    id, name, columns, rows, labelWidthMm: CR80_W, labelHeightMm: CR80_H,
    marginTopMm, marginLeftMm, gutterXMm: CARD_GUTTER, gutterYMm: CARD_GUTTER, cornerRadiusMm: 3.18,
  }, page);
}

function thermal(id: string, name: string, widthIn: number, heightIn: number): LabelMedia {
  return {
    id, name, family: 'thermal', pageWidthMm: widthIn * IN, pageHeightMm: heightIn * IN,
    columns: 1, rows: 1, labelWidthMm: widthIn * IN, labelHeightMm: heightIn * IN,
    marginTopMm: 0, marginLeftMm: 0, gutterXMm: 0, gutterYMm: 0, cornerRadiusMm: 0,
    dpi: THERMAL_DPI, minModuleMm: THERMAL_MIN_MODULE_MM,
  };
}

export const LABEL_MEDIA: readonly LabelMedia[] = [
  sheet({ id: 'a4-l7160', name: 'A4 · L7160 · 21 per sheet (63.5 × 38.1 mm)', columns: 3, rows: 7, labelWidthMm: 63.5, labelHeightMm: 38.1, marginTopMm: 15.15, marginLeftMm: 7.25, gutterXMm: 2.54, gutterYMm: 0, cornerRadiusMm: 1.5 }, A4),
  sheet({ id: 'a4-l7163', name: 'A4 · L7163 · 14 per sheet (99.1 × 38.1 mm)', columns: 2, rows: 7, labelWidthMm: 99.1, labelHeightMm: 38.1, marginTopMm: 15.15, marginLeftMm: 4.65, gutterXMm: 2.5, gutterYMm: 0, cornerRadiusMm: 1.5 }, A4),
  sheet({ id: 'a4-l7165', name: 'A4 · L7165 · 8 per sheet (99.1 × 67.7 mm)', columns: 2, rows: 4, labelWidthMm: 99.1, labelHeightMm: 67.7, marginTopMm: 13.1, marginLeftMm: 4.65, gutterXMm: 2.5, gutterYMm: 0, cornerRadiusMm: 1.5 }, A4),
  sheet({ id: 'a4-l7173', name: 'A4 · L7173 · 10 per sheet (99.1 × 57 mm)', columns: 2, rows: 5, labelWidthMm: 99.1, labelHeightMm: 57, marginTopMm: 6, marginLeftMm: 4.65, gutterXMm: 2.5, gutterYMm: 0, cornerRadiusMm: 1.5 }, A4),
  sheet({ id: 'a4-l7651', name: 'A4 · L7651 · 65 per sheet (38.1 × 21.2 mm)', columns: 5, rows: 13, labelWidthMm: 38.1, labelHeightMm: 21.2, marginTopMm: 10.7, marginLeftMm: 4.7, gutterXMm: 2.5, gutterYMm: 0, cornerRadiusMm: 1 }, A4),
  sheet({ id: 'a4-a6', name: 'A4 · 4 per sheet (A6, 105 × 148.5 mm)', columns: 2, rows: 2, labelWidthMm: 105, labelHeightMm: 148.5, marginTopMm: 0, marginLeftMm: 0, gutterXMm: 0, gutterYMm: 0, cornerRadiusMm: 0 }, A4),
  sheet({ id: 'a4-placard', name: 'A4 · placard, 1 per page', columns: 1, rows: 1, labelWidthMm: 190, labelHeightMm: 277, marginTopMm: 10, marginLeftMm: 10, gutterXMm: 0, gutterYMm: 0, cornerRadiusMm: 0 }, A4),
  cards('a4-cr80', 'A4 · ID cards (CR80), 10 per sheet', A4, 2, 5),
  sheet({ id: 'letter-5160', name: 'Letter · 5160 · 30 per sheet (2.625 × 1 in)', columns: 3, rows: 10, labelWidthMm: 2.625 * IN, labelHeightMm: 1 * IN, marginTopMm: 0.5 * IN, marginLeftMm: 0.1875 * IN, gutterXMm: 0.125 * IN, gutterYMm: 0, cornerRadiusMm: 1.5 }, LETTER),
  sheet({ id: 'letter-5163', name: 'Letter · 5163 · 10 per sheet (4 × 2 in)', columns: 2, rows: 5, labelWidthMm: 4 * IN, labelHeightMm: 2 * IN, marginTopMm: 0.5 * IN, marginLeftMm: 0.15625 * IN, gutterXMm: 0.1875 * IN, gutterYMm: 0, cornerRadiusMm: 1.5 }, LETTER),
  sheet({ id: 'letter-22805', name: 'Letter · 22805 · 24 per sheet (1.5 in square)', columns: 4, rows: 6, labelWidthMm: 1.5 * IN, labelHeightMm: 1.5 * IN, marginTopMm: 0.625 * IN, marginLeftMm: 0.625 * IN, gutterXMm: 0.3125 * IN, gutterYMm: 0.2 * IN, cornerRadiusMm: 1.5 }, LETTER),
  sheet({ id: 'letter-placard', name: 'Letter · placard, 1 per page', columns: 1, rows: 1, labelWidthMm: LETTER.pageWidthMm - 2 * 12.7, labelHeightMm: LETTER.pageHeightMm - 2 * 12.7, marginTopMm: 12.7, marginLeftMm: 12.7, gutterXMm: 0, gutterYMm: 0, cornerRadiusMm: 0 }, LETTER),
  cards('letter-cr80', 'Letter · ID cards (CR80), 8 per sheet', LETTER, 2, 4),
  thermal('thermal-4x6', 'Thermal roll · 4 × 6 in', 4, 6),
  thermal('thermal-4x2', 'Thermal roll · 4 × 2 in', 4, 2),
  thermal('thermal-2x1', 'Thermal roll · 2 × 1 in', 2, 1),
];

/** The default media when neither the job nor the template names one. */
export const DEFAULT_LABEL_MEDIA_ID = 'a4-l7160';

/** A media definition that cannot hold its labels. */
export class LabelMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelMediaError';
  }
}

const EPSILON_MM = 0.05;

/** Throws LabelMediaError unless every label sits inside the page. */
export function assertValidMedia(media: LabelMedia): void {
  const sizes = [media.pageWidthMm, media.pageHeightMm, media.labelWidthMm, media.labelHeightMm];
  if (sizes.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new LabelMediaError(`media "${media.id}": page and label sizes must be positive`);
  }
  if (!Number.isInteger(media.columns) || !Number.isInteger(media.rows) || media.columns < 1 || media.rows < 1) {
    throw new LabelMediaError(`media "${media.id}": columns and rows must be positive integers`);
  }
  const offsets = [media.marginTopMm, media.marginLeftMm, media.gutterXMm, media.gutterYMm, media.cornerRadiusMm];
  if (offsets.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new LabelMediaError(`media "${media.id}": margins, gutters and radius must not be negative`);
  }
  const right = media.marginLeftMm + media.columns * media.labelWidthMm + (media.columns - 1) * media.gutterXMm;
  const bottom = media.marginTopMm + media.rows * media.labelHeightMm + (media.rows - 1) * media.gutterYMm;
  if (right > media.pageWidthMm + EPSILON_MM || bottom > media.pageHeightMm + EPSILON_MM) {
    throw new LabelMediaError(`media "${media.id}": labels run past the page edge`);
  }
  if (!(media.minModuleMm > 0)) {
    throw new LabelMediaError(`media "${media.id}": minModuleMm must be positive`);
  }
  if (media.family === 'thermal' && !(media.dpi && media.dpi > 0)) {
    throw new LabelMediaError(`media "${media.id}": thermal media need a dpi`);
  }
}

/**
 * The media a job prints on: a preset id (from `presets`, which hosts may
 * extend) or a custom definition, validated either way.
 */
export function resolveMedia(media: string | LabelMedia, presets: readonly LabelMedia[] = LABEL_MEDIA): LabelMedia {
  const found = typeof media === 'string' ? presets.find((m) => m.id === media) : media;
  if (!found) throw new LabelMediaError(`unknown media "${String(media)}"`);
  assertValidMedia(found);
  return found;
}

/** Labels per page. */
export function slotsPerPage(media: LabelMedia): number {
  return media.columns * media.rows;
}

/** The top-left corner of a slot on the page. */
export function slotOrigin(media: LabelMedia, slot: number): { x: number; y: number } {
  const column = slot % media.columns;
  const row = Math.floor(slot / media.columns);
  return {
    x: media.marginLeftMm + column * (media.labelWidthMm + media.gutterXMm),
    y: media.marginTopMm + row * (media.labelHeightMm + media.gutterYMm),
  };
}
