// Barcode encoding: the one module that knows bwip-js. Renderers draw the
// dark modules this returns; ZPL uses the printer's own encoder instead.

import bwipjs from 'bwip-js';

import type { LabelSymbology } from './types';

export interface EncodedSymbol {
  /**
   * Dark modules as an SVG path. Code 128: x in modules, y from 0 to 1
   * (bars span the full height). Matrix codes: x and y in modules.
   */
  path: string;
  widthModules: number;
  heightModules: number;
}

/** Data the symbology cannot carry. The message never repeats the data. */
export class SymbolEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SymbolEncodeError';
  }
}

const BCID: Record<LabelSymbology, string> = { code128: 'code128', qrcode: 'qrcode', datamatrix: 'datamatrix' };
const QUIET_ZONE: Record<LabelSymbology, number> = { code128: 10, qrcode: 4, datamatrix: 1 };
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** The blank margin, in modules, a scanner needs around the symbol. */
export function quietZoneModules(symbology: LabelSymbology): number {
  return QUIET_ZONE[symbology];
}

type RawLinear = { sbs: number[] };
type RawMatrix = { pixs: number[]; pixx: number; pixy: number };

function linearPath(sbs: number[]): { path: string; width: number } {
  let x = 0;
  const bars: string[] = [];
  sbs.forEach((run, i) => {
    if (i % 2 === 0) bars.push(`M${x} 0h${run}v1h-${run}z`);
    x += run;
  });
  return { path: bars.join(''), width: x };
}

function matrixPath(raw: RawMatrix): string {
  const rows: string[] = [];
  for (let y = 0; y < raw.pixy; y++) {
    let x = 0;
    while (x < raw.pixx) {
      if (!raw.pixs[y * raw.pixx + x]) { x++; continue; }
      const start = x;
      while (x < raw.pixx && raw.pixs[y * raw.pixx + x]) x++;
      rows.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return rows.join('');
}

/** Encode `data` in `symbology`; throws SymbolEncodeError when it cannot be carried. */
export function encodeSymbol(symbology: LabelSymbology, data: string): EncodedSymbol {
  if (!data) throw new SymbolEncodeError('a code is empty');
  if (symbology === 'code128' && !PRINTABLE_ASCII.test(data)) {
    throw new SymbolEncodeError('Code 128 carries printable ASCII only');
  }
  let raw: Array<RawLinear | RawMatrix>;
  try {
    raw = bwipjs.raw(BCID[symbology], data, {}) as Array<RawLinear | RawMatrix>;
  } catch {
    throw new SymbolEncodeError(`a code cannot be encoded as ${symbology}`);
  }
  const first = raw[0];
  if ('sbs' in first) {
    const { path, width } = linearPath(first.sbs);
    return { path, widthModules: width, heightModules: 1 };
  }
  return { path: matrixPath(first), widthModules: first.pixx, heightModules: first.pixy };
}
