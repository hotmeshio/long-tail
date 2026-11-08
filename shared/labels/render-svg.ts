// LabelSheet → one SVG per page, sized in millimetres for print. A barcode is
// a document: black on white, whatever the screen theme.

import { cutMarkSegments } from './layout';
import type { LabelElement, LabelSheet, PlacedLabel } from './types';

export interface SvgRenderOptions {
  /** Draw each label's outline (screen preview only; never printed). */
  outlines?: boolean;
  fontFamily?: string;
}

const DEFAULT_FONT = 'Helvetica, Arial, sans-serif';
const r = (n: number) => Math.round(n * 1000) / 1000;

/** Escape text for XML content and attributes. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function element(el: LabelElement, font: string): string {
  if (el.kind === 'rect') {
    return el.fill
      ? `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" fill="#000"/>`
      : `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" fill="none" stroke="#000" stroke-width="${r(el.stroke ?? 0.3)}"/>`;
  }
  if (el.kind === 'text') {
    const x = el.align === 'center' ? el.x + el.w / 2 : el.x;
    return `<text x="${r(x)}" y="${r(el.y + el.size * 0.8)}" font-family="${escapeXml(font)}" font-size="${r(el.size)}" ` +
      `font-weight="${el.weight === 'bold' ? 700 : 400}" text-anchor="${el.align === 'center' ? 'middle' : 'start'}" ` +
      `fill="${el.inverse ? '#fff' : '#000'}">${escapeXml(el.text)}</text>`;
  }
  if (el.masked) {
    const size = Math.min(el.h * 0.3, 3);
    return `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" fill="#ddd" stroke="#888" stroke-width="0.2" stroke-dasharray="1 1"/>` +
      `<text x="${r(el.x + el.w / 2)}" y="${r(el.y + el.h / 2 + size * 0.35)}" font-family="${escapeXml(font)}" font-size="${r(size)}" text-anchor="middle" fill="#555">Code prints on confirm</text>`;
  }
  return `<path class="lt-label-symbol" data-code="${escapeXml(el.data)}" d="${el.path}" fill="#000" ` +
    `transform="translate(${r(el.x)} ${r(el.y)}) scale(${r(el.moduleMm)} ${el.symbology === 'code128' ? r(el.h) : r(el.moduleMm)})"/>`;
}

function label(placed: PlacedLabel, font: string, outline: boolean, radius: number): string {
  const body = placed.elements.map((el) => element(el, font)).join('');
  const frame = outline
    ? `<rect x="0" y="0" width="${r(placed.w)}" height="${r(placed.h)}" rx="${r(radius)}" fill="none" stroke="#bbb" stroke-width="0.2" stroke-dasharray="1 1"/>`
    : '';
  return `<g class="lt-label" data-index="${placed.index}" data-slot="${placed.slot}" transform="translate(${r(placed.x)} ${r(placed.y)})">${frame}${body}</g>`;
}

/** Render every page of a sheet as a standalone SVG document string. */
export function renderSheetSvg(sheet: LabelSheet, opts: SvgRenderOptions = {}): string[] {
  const { media } = sheet;
  const font = opts.fontFamily ?? DEFAULT_FONT;
  const marks = sheet.cutMarks
    ? cutMarkSegments(media).map(([x1, y1, x2, y2]) => `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="#000" stroke-width="0.15"/>`).join('')
    : '';
  return sheet.pages.map((page) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="lt-print-page" width="${r(media.pageWidthMm)}mm" height="${r(media.pageHeightMm)}mm" ` +
    `viewBox="0 0 ${r(media.pageWidthMm)} ${r(media.pageHeightMm)}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${marks}` +
    page.labels.map((placed) => label(placed, font, !!opts.outlines, media.cornerRadiusMm)).join('') +
    '</svg>',
  );
}
