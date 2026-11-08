// LabelSheet → PDF at exact page size. Text uses Helvetica unless the host
// registers a font (start({ labels: { font } })) for scripts beyond Latin-1.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { cutMarkSegments } from '../../shared/labels/layout';
import type { LabelElement, LabelSheet } from '../../shared/labels/types';

const PT_PER_MM = 72 / 25.4;
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const pt = (mm: number) => mm * PT_PER_MM;

export interface LabelFonts {
  regular: Uint8Array;
  bold?: Uint8Array;
}

let hostFonts: LabelFonts | null = null;

/** Fonts for label text in PDFs (TrueType or OpenType bytes). */
export function registerLabelFonts(fonts: LabelFonts | null): void {
  hostFonts = fonts;
}

/** Characters Helvetica (WinAnsi) cannot draw become "?"; a host font draws them all. */
function drawable(text: string, font: PDFFont): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return Array.from(text, (ch) => {
      try { font.encodeText(ch); return ch; } catch { return '?'; }
    }).join('');
  }
}

function drawElement(page: PDFPage, el: LabelElement, ox: number, oy: number, height: number, fonts: { regular: PDFFont; bold: PDFFont }): void {
  const y = (mm: number) => height - pt(oy + mm);
  if (el.kind === 'rect') {
    page.drawRectangle({
      x: pt(ox + el.x), y: y(el.y + el.h), width: pt(el.w), height: pt(el.h),
      ...(el.fill ? { color: BLACK } : { borderColor: BLACK, borderWidth: pt(el.stroke ?? 0.3) }),
    });
    return;
  }
  if (el.kind === 'text') {
    const font = el.weight === 'bold' ? fonts.bold : fonts.regular;
    const text = drawable(el.text, font);
    let size = pt(el.size);
    const max = pt(el.w);
    const measured = font.widthOfTextAtSize(text, size);
    if (measured > max) size *= max / measured;
    const width = font.widthOfTextAtSize(text, size);
    const x = el.align === 'center' ? pt(ox + el.x) + (max - width) / 2 : pt(ox + el.x);
    page.drawText(text, { x, y: y(el.y + el.size * 0.8), size, font, color: el.inverse ? WHITE : BLACK });
    return;
  }
  if (el.masked) {
    page.drawRectangle({ x: pt(ox + el.x), y: y(el.y + el.h), width: pt(el.w), height: pt(el.h), color: rgb(0.87, 0.87, 0.87) });
    return;
  }
  const scaleY = el.symbology === 'code128' ? pt(el.h) : pt(el.moduleMm);
  page.drawSvgPath(scalePath(el.path, pt(el.moduleMm), scaleY), { x: pt(ox + el.x), y: height - pt(oy + el.y), color: BLACK });
}

/** Scale an SVG path of M/h/v/z commands by (sx, sy); pdf-lib's own scale is uniform. */
export function scalePath(path: string, sx: number, sy: number): string {
  return path.replace(/([Mhv])(-?[\d.]+)(?: (-?[\d.]+))?/g, (_m, cmd: string, a: string, b?: string) => {
    if (cmd === 'M') return `M${Number(a) * sx} ${Number(b) * sy}`;
    return `${cmd}${Number(a) * (cmd === 'h' ? sx : sy)}`;
  });
}

/** Render a sheet as a PDF document. */
export async function renderSheetPdf(sheet: LabelSheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let fonts: { regular: PDFFont; bold: PDFFont };
  if (hostFonts) {
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(hostFonts.regular, { subset: true });
    fonts = { regular, bold: hostFonts.bold ? await doc.embedFont(hostFonts.bold, { subset: true }) : regular };
  } else {
    fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  }
  const { media } = sheet;
  const width = pt(media.pageWidthMm);
  const height = pt(media.pageHeightMm);
  for (const sheetPage of sheet.pages) {
    const page = doc.addPage([width, height]);
    if (sheet.cutMarks) {
      for (const [x1, y1, x2, y2] of cutMarkSegments(media)) {
        page.drawLine({ start: { x: pt(x1), y: height - pt(y1) }, end: { x: pt(x2), y: height - pt(y2) }, thickness: pt(0.15), color: BLACK });
      }
    }
    for (const placed of sheetPage.labels) {
      for (const el of placed.elements) drawElement(page, el, placed.x, placed.y, height, fonts);
    }
  }
  doc.setProducer('Long Tail label sheets');
  doc.setCreationDate(new Date(0));
  return doc.save();
}
