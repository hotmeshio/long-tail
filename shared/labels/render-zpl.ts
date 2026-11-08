// LabelSheet → ZPL for thermal printers: one ^XA…^XZ per printed label, with
// the printer's own barcode commands so bars land on whole dots.

import type { LabelElement, LabelSheet } from './types';

/** A sheet that cannot be rendered as ZPL. */
export class ZplRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZplRenderError';
  }
}

const MM_PER_INCH = 25.4;

/** Field data with ^FH escaping: the ZPL command characters and the escape itself become hex. */
export function zplField(text: string): string {
  return text.replace(/[\^~_\\]/g, (c) => `_${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function element(el: LabelElement, dots: (mm: number) => number): string {
  if (el.kind === 'rect') {
    const w = Math.max(1, dots(el.w));
    const h = Math.max(1, dots(el.h));
    const thickness = el.fill ? Math.min(w, h) : Math.max(1, dots(el.stroke ?? 0.3));
    return `^FO${dots(el.x)},${dots(el.y)}^GB${w},${h},${thickness}^FS`;
  }
  if (el.kind === 'text') {
    const size = Math.max(10, dots(el.size));
    const justify = el.align === 'center' ? 'C' : 'L';
    return `^FO${dots(el.x)},${dots(el.y)}^A0N,${size},${size}^FB${Math.max(1, dots(el.w))},1,0,${justify}` +
      `${el.inverse ? '^FR' : ''}^FH^FD${zplField(el.text)}^FS`;
  }
  if (el.masked) {
    throw new ZplRenderError('a masked label cannot be sent to a printer');
  }
  const module = Math.max(1, dots(el.moduleMm));
  const at = `^FO${dots(el.x)},${dots(el.y)}`;
  if (el.symbology === 'code128') {
    return `^BY${module},3,${Math.max(1, dots(el.h))}${at}^BCN,${Math.max(1, dots(el.h))},N,N,N,A^FH^FD${zplField(el.data)}^FS`;
  }
  if (el.symbology === 'qrcode') {
    return `${at}^BQN,2,${Math.min(10, module)}^FH^FDMA,${zplField(el.data)}^FS`;
  }
  return `${at}^BXN,${module},200^FH^FD${zplField(el.data)}^FS`;
}

/** Render a thermal sheet as one ZPL document, one label format per printed label. */
export function renderSheetZpl(sheet: LabelSheet): string {
  const { media } = sheet;
  if (media.family !== 'thermal' || !media.dpi) {
    throw new ZplRenderError(`media "${media.id}" is not thermal stock; ZPL renders thermal media only`);
  }
  const dpmm = media.dpi / MM_PER_INCH;
  const dots = (mm: number) => Math.round(mm * dpmm);
  const formats: string[] = [];
  for (const page of sheet.pages) {
    for (const placed of page.labels) {
      const body = placed.elements.map((el) => element(el, dots)).join('\n');
      formats.push(`^XA\n^CI28\n^LH0,0\n^PW${dots(media.labelWidthMm)}\n^LL${dots(media.labelHeightMm)}\n${body}\n^XZ`);
    }
  }
  return formats.join('\n');
}
