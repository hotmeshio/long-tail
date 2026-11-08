// Places labels on pages: start position on a partly used sheet, copies per
// label, one label per page, and cut marks for card stock.

import { layoutLabelContent } from './label-content';
import { slotOrigin, slotsPerPage } from './media';
import type { LabelContent, LabelMedia, LabelPage, LabelSheet, LabelSymbology, LabelWarning } from './types';

export interface LabelSheetInput {
  media: LabelMedia;
  labels: LabelContent[];
  symbology: LabelSymbology;
  humanReadable: boolean;
  /** The first slot to print on page one, counted from 1, so used labels are skipped. */
  startPosition?: number;
  /** Copies of each label, printed together. */
  copies?: number;
  /** One label per page, in the start slot (placards). */
  onePerPage?: boolean;
  cutMarks?: boolean;
}

/** A sheet request that cannot be laid out. */
export class LabelLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelLayoutError';
  }
}

export const MAX_COPIES = 50;

/** Lay out every label of a job onto pages. */
export function buildLabelSheet(input: LabelSheetInput): LabelSheet {
  const { media } = input;
  const perPage = slotsPerPage(media);
  const start = input.startPosition ?? 1;
  const copies = input.copies ?? 1;
  if (!Number.isInteger(start) || start < 1 || start > perPage) {
    throw new LabelLayoutError(`start position must be between 1 and ${perPage}`);
  }
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    throw new LabelLayoutError(`copies must be between 1 and ${MAX_COPIES}`);
  }

  const warnings: LabelWarning[] = [];
  const laidOut = input.labels.map((content, index) => {
    const result = layoutLabelContent(content, media.labelWidthMm, media.labelHeightMm, {
      symbology: input.symbology,
      humanReadable: input.humanReadable,
      minModuleMm: media.minModuleMm,
    });
    for (const w of result.warnings) warnings.push({ index, ...w });
    return result.elements;
  });

  const pages: LabelPage[] = [];
  let slot = start - 1;
  let page: LabelPage | null = null;
  laidOut.forEach((elements, index) => {
    for (let copy = 0; copy < copies; copy++) {
      if (!page || slot >= perPage || input.onePerPage) {
        if (page) slot = input.onePerPage ? start - 1 : 0;
        page = { labels: [] };
        pages.push(page);
      }
      const origin = slotOrigin(media, slot);
      page.labels.push({ slot, index, x: origin.x, y: origin.y, w: media.labelWidthMm, h: media.labelHeightMm, elements });
      slot += 1;
    }
  });

  return { media, pages, cutMarks: !!input.cutMarks, warnings };
}

/** Short tick marks at every label corner, outside the label, for cutting card stock. */
export function cutMarkSegments(media: LabelMedia, length = 3): Array<[number, number, number, number]> {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (let s = 0; s < slotsPerPage(media); s++) {
    const o = slotOrigin(media, s);
    xs.add(o.x).add(o.x + media.labelWidthMm);
    ys.add(o.y).add(o.y + media.labelHeightMm);
  }
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const segments: Array<[number, number, number, number]> = [];
  for (const x of xs) {
    segments.push([x, Math.max(0, top - length - 1), x, top - 1], [x, bottom + 1, x, Math.min(media.pageHeightMm, bottom + length + 1)]);
  }
  for (const y of ys) {
    segments.push([Math.max(0, left - length - 1), y, left - 1, y], [right + 1, y, Math.min(media.pageWidthMm, right + length + 1), y]);
  }
  return segments.filter(([x1, y1, x2, y2]) => x1 !== x2 || y1 !== y2);
}
