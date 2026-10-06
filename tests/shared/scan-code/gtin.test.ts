import { describe, it, expect } from 'vitest';

import { isValidGtin, normalizeGtin } from '../../../shared/scan-code';

describe('isValidGtin', () => {
  it('accepts valid UPC-A, EAN-13, EAN-8 and GTIN-14 codes', () => {
    expect(isValidGtin('036000291452')).toBe(true);    // UPC-A
    expect(isValidGtin('4006381333931')).toBe(true);   // EAN-13
    expect(isValidGtin('73513537')).toBe(true);        // EAN-8
    expect(isValidGtin('10036000291459')).toBe(true);  // GTIN-14
  });

  it('rejects a wrong check digit', () => {
    expect(isValidGtin('036000291453')).toBe(false);
    expect(isValidGtin('4006381333932')).toBe(false);
  });

  it('rejects lengths and characters a GTIN never has', () => {
    expect(isValidGtin('0360002914')).toBe(false);
    expect(isValidGtin('03600029145A')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });
});

describe('normalizeGtin', () => {
  it('left-pads to 14 digits so UPC-A and its EAN-13 form compare equal', () => {
    expect(normalizeGtin('036000291452')).toBe('00036000291452');
    expect(normalizeGtin('0036000291452')).toBe('00036000291452');
    expect(normalizeGtin('10036000291459')).toBe('10036000291459');
  });
});
