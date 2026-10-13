import { describe, it, expect } from 'vitest';

import { displayGtin, isValidGtin, normalizeGtin } from '../../../shared/scan-code';

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

describe('displayGtin', () => {
  it('reads a stored GTIN-14 as the package prints it', () => {
    expect(displayGtin('00812999000011')).toBe('0812999000011');
    expect(displayGtin(normalizeGtin('036000291452'))).toBe('0036000291452');
    expect(displayGtin(normalizeGtin('96385074'))).toBe('96385074');
    expect(displayGtin('10036000291459')).toBe('10036000291459');
  });

  it('leaves anything that is not a valid GTIN-14 alone', () => {
    expect(displayGtin('00812999000012')).toBe('00812999000012');
    expect(displayGtin('SF-A-2')).toBe('SF-A-2');
  });
});
