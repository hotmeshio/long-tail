import { describe, it, expect } from 'vitest';

import { parseScanCode, type ParseableScheme } from '../../../shared/scan-code';

const scheme = (over: Partial<ParseableScheme>): ParseableScheme => ({
  version: 11, name: 'Bag', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, ...over,
});

const BAG = scheme({});
const SHOE = scheme({ version: 16, name: 'Shoe', encoding: 'gtin' });
const SERIAL = scheme({ version: 20, name: 'Serial', encoding: 'fixed', target_length: 6 });

describe('parseScanCode — manufacturer barcodes', () => {
  it('reads a UPC-A under the gtin scheme with category 0 and a 14-digit target', () => {
    const result = parseScanCode('036000291452', [BAG, SHOE]);
    expect(result).toMatchObject({
      ok: true,
      parsed: { version: 16, category: '0', target: '00036000291452', raw: '036000291452' },
    });
  });

  it('keeps the leading zero of a UPC-A as part of the code', () => {
    const result = parseScanCode('012345678905', [SHOE]);
    expect(result.ok && result.parsed.raw).toBe('012345678905');
  });

  it('a digits-only code that fails its check digit is not a GTIN', () => {
    const result = parseScanCode('036000291453', [BAG, SHOE]);
    expect(result.ok).toBe(false);
  });

  it('a fixed scheme that reads the code wins over the gtin scheme', () => {
    const result = parseScanCode('2017554332', [SERIAL, SHOE]);
    expect(result).toMatchObject({ ok: true, parsed: { version: 20, category: '1', target: '755433' } });
  });

  it('a disabled gtin scheme answers scheme_disabled for a valid barcode', () => {
    const result = parseScanCode('036000291452', [{ ...SHOE, enabled: false }]);
    expect(result).toMatchObject({ ok: false, failure: { reason: 'scheme_disabled' } });
  });

  it('a version-prefixed code naming the gtin scheme is malformed', () => {
    const result = parseScanCode('16:0:ABC', [SHOE]);
    expect(result).toMatchObject({ ok: false, failure: { reason: 'malformed' } });
  });

  it('delimited codes parse as before alongside a gtin scheme', () => {
    const result = parseScanCode('11:0:K7Q2M9XA', [BAG, SHOE]);
    expect(result).toMatchObject({ ok: true, parsed: { version: 11, category: '0', target: 'K7Q2M9XA' } });
  });
});
