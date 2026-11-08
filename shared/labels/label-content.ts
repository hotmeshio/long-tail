// Lays out one label: title, lines, then one panel per code (caption band,
// symbol, readable code). Coordinates are millimetres from the label's corner.

import { encodeSymbol, quietZoneModules, SymbolEncodeError } from './symbol';
import type { LabelCode, LabelContent, LabelElement, LabelSymbology, LabelWarningKind } from './types';

export interface LabelContentOptions {
  symbology: LabelSymbology;
  humanReadable: boolean;
  minModuleMm: number;
}

export interface LabelContentResult {
  elements: LabelElement[];
  warnings: { kind: LabelWarningKind; detail: string }[];
}

/** Average glyph advance as a fraction of the font size, for fitting text without font metrics. */
export const GLYPH_ADVANCE = 0.56;
const MIN_TEXT_MM = 1.6;
const MAX_LINEAR_MODULE_MM = 0.6;
const MAX_MATRIX_MODULE_MM = 1.4;
const MAX_BAR_HEIGHT_MM = 30;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The largest font size up to `size` at which `text` fits `width`, or null below the floor. */
function fitText(text: string, width: number, size: number): number | null {
  const fitted = Math.min(size, width / Math.max(1, text.length * GLYPH_ADVANCE));
  return fitted >= MIN_TEXT_MM ? fitted : null;
}

/** Text that fits `width` at the floor size, cut with an ellipsis. */
function truncateTo(text: string, width: number): string {
  const max = Math.max(1, Math.floor(width / (MIN_TEXT_MM * GLYPH_ADVANCE)));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

interface Box { x: number; y: number; w: number; h: number }

function textRow(
  text: string, box: Box, size: number, weight: 'regular' | 'bold', out: LabelContentResult,
): number {
  let fitted = fitText(text, box.w, size);
  let shown = text;
  if (fitted === null) {
    shown = truncateTo(text, box.w);
    fitted = MIN_TEXT_MM;
    out.warnings.push({ kind: 'overflow', detail: `"${text}" is too long for the label and was shortened` });
  }
  out.elements.push({ kind: 'text', x: box.x, y: box.y, w: box.w, size: fitted, text: shown, weight, align: 'center' });
  return size * 1.2;
}

interface PanelPlan { moduleMm: number; elements: LabelElement[]; quietOk: boolean }

function planPanel(code: LabelCode, box: Box, opts: LabelContentOptions): PanelPlan {
  const elements: LabelElement[] = [];
  const gap = clamp(box.h * 0.04, 0.4, 1.5);
  let y = box.y;
  if (code.caption) {
    const band = clamp(box.h * 0.2, 2.2, 7);
    const size = Math.min(band * 0.62, box.w / Math.max(1, code.caption.length * GLYPH_ADVANCE));
    if (code.tone === 'solid') elements.push({ kind: 'rect', x: box.x, y, w: box.w, h: band, fill: true });
    if (code.tone === 'outline') elements.push({ kind: 'rect', x: box.x, y, w: box.w, h: band, fill: false, stroke: clamp(band * 0.08, 0.2, 0.5) });
    elements.push({
      kind: 'text', x: box.x, y: y + (band - size) / 2, w: box.w, size: Math.max(size, MIN_TEXT_MM),
      text: code.caption, weight: 'bold', align: 'center', inverse: code.tone === 'solid',
    });
    y += band + gap;
  }
  const readable = opts.humanReadable ? clamp(box.h * 0.1, 1.6, 3.2) : 0;
  const symbolH = box.y + box.h - y - (readable ? readable + gap : 0);
  const encoded = encodeSymbol(opts.symbology, code.code);
  const quiet = quietZoneModules(opts.symbology);
  const linear = opts.symbology === 'code128';
  const moduleMm = linear
    ? Math.min(MAX_LINEAR_MODULE_MM, box.w / (encoded.widthModules + 2 * quiet))
    : Math.min(MAX_MATRIX_MODULE_MM, Math.min(box.w, symbolH) / (encoded.widthModules + 2 * quiet));
  const w = encoded.widthModules * moduleMm;
  const h = linear ? Math.min(symbolH, MAX_BAR_HEIGHT_MM) : encoded.heightModules * moduleMm;
  elements.push({
    kind: 'symbol', x: box.x + (box.w - w) / 2, y, w, h,
    symbology: opts.symbology, data: code.code, moduleMm, path: encoded.path,
  });
  if (readable) {
    elements.push({
      kind: 'text', x: box.x, y: y + h + gap, w: box.w,
      size: Math.max(MIN_TEXT_MM, Math.min(readable * 0.85, box.w / Math.max(1, code.code.length * GLYPH_ADVANCE))),
      text: code.code, weight: 'regular', align: 'center',
    });
  }
  return { moduleMm, elements, quietOk: symbolH > 0 && w + 2 * quiet * moduleMm <= box.w + 1e-6 };
}

function planPanels(codes: LabelCode[], area: Box, across: boolean, opts: LabelContentOptions): PanelPlan[] {
  const n = codes.length;
  const gap = clamp(Math.min(area.w, area.h) * 0.05, 0.8, 4);
  return codes.map((code, i) => {
    const box = across
      ? { x: area.x + i * ((area.w - gap * (n - 1)) / n + gap), y: area.y, w: (area.w - gap * (n - 1)) / n, h: area.h }
      : { x: area.x, y: area.y + i * ((area.h - gap * (n - 1)) / n + gap), w: area.w, h: (area.h - gap * (n - 1)) / n };
    return planPanel(code, box, opts);
  });
}

const smallest = (plans: PanelPlan[]) => Math.min(...plans.map((p) => p.moduleMm));

/** Lay out one label's content inside a `width` × `height` box. */
export function layoutLabelContent(
  content: LabelContent, width: number, height: number, opts: LabelContentOptions,
): LabelContentResult {
  const out: LabelContentResult = { elements: [], warnings: [] };
  const pad = clamp(Math.min(width, height) * 0.05, 1, 4);
  const inner: Box = { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad };
  let y = inner.y;
  if (content.title) {
    y += textRow(content.title, { ...inner, y }, clamp(inner.h * 0.15, 2.2, 10), 'bold', out);
  }
  const lineSize = clamp(inner.h * 0.09, 1.8, 6);
  for (const line of content.lines.filter(Boolean)) {
    y += textRow(line, { ...inner, y }, lineSize, 'regular', out);
  }
  if (content.codes.length === 0) return out;

  const area: Box = { x: inner.x, y: y + (y > inner.y ? pad / 2 : 0), w: inner.w, h: 0 };
  area.h = inner.y + inner.h - area.y;
  let plans: PanelPlan[];
  try {
    const stacked = planPanels(content.codes, area, false, opts);
    const across = content.codes.length > 1 ? planPanels(content.codes, area, true, opts) : stacked;
    plans = smallest(across) > smallest(stacked) ? across : stacked;
  } catch (err) {
    if (!(err instanceof SymbolEncodeError)) throw err;
    out.warnings.push({ kind: 'unencodable', detail: err.message });
    return out;
  }
  for (const plan of plans) out.elements.push(...plan.elements);
  const module = smallest(plans);
  if (module < opts.minModuleMm) {
    out.warnings.push({
      kind: 'scale',
      detail: `bars print at ${module.toFixed(2)} mm, below the ${opts.minModuleMm} mm a scanner reads reliably; use larger labels or fewer codes`,
    });
  }
  if (plans.some((p) => !p.quietOk)) {
    out.warnings.push({ kind: 'quiet_zone', detail: 'a code has too little blank margin around it to scan reliably' });
  }
  if (content.masked) {
    for (const el of out.elements) {
      if (el.kind === 'symbol') Object.assign(el, { data: '', path: '', masked: true });
      if (el.kind === 'text' && content.codes.some((c) => c.code === el.text)) el.text = '•'.repeat(8);
    }
  }
  return out;
}
