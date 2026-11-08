import { describe, it, expect } from 'vitest';

import { encodeSymbol, quietZoneModules, SymbolEncodeError } from '../../../shared/labels/symbol';

describe('encodeSymbol', () => {
  it('encodes Code 128 as full-height bars in module units', () => {
    const s = encodeSymbol('code128', '14:1:A-3');
    expect(s.heightModules).toBe(1);
    expect(s.widthModules).toBeGreaterThan(50);
    expect(s.path).toMatch(/^M0 0h\d+v1h-\d+z/);
  });

  it('encodes QR and DataMatrix as square module grids', () => {
    const qr = encodeSymbol('qrcode', '12:0:ABCDEF');
    expect(qr.widthModules).toBe(21);
    expect(qr.heightModules).toBe(21);
    const dm = encodeSymbol('datamatrix', '12:0:ABCDEF');
    expect(dm.widthModules).toBe(dm.heightModules);
    expect(dm.path.length).toBeGreaterThan(0);
  });

  it('refuses empty data and non-ASCII Code 128 without echoing the data', () => {
    expect(() => encodeSymbol('code128', '')).toThrow(SymbolEncodeError);
    try {
      encodeSymbol('code128', 'SECRET-é');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SymbolEncodeError);
      expect((err as Error).message).not.toContain('SECRET');
    }
  });

  it('names each symbology\'s quiet zone', () => {
    expect(quietZoneModules('code128')).toBe(10);
    expect(quietZoneModules('qrcode')).toBe(4);
    expect(quietZoneModules('datamatrix')).toBe(1);
  });
});
