import { describe, it, expect } from 'vitest';

import { compilePattern, parseScanCode, PATTERN_CODE_MAX_LENGTH, unanchorPattern, type ParseableScheme } from '../../../shared/scan-code';

const scheme = (over: Partial<ParseableScheme>): ParseableScheme => ({
  version: 11, name: 'Bag', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, ...over,
});

const UPS = '1Z1380B21BB46041B0';
const BAG = scheme({});
const SHOE = scheme({ version: 16, name: 'Shoe', encoding: 'gtin' });
const PARCEL = scheme({ version: 18, name: 'Parcel', encoding: 'pattern', patterns: ['1Z[0-9A-Z]{16}', '[0-9]{12}'] });

describe('parseScanCode — pattern schemes', () => {
  it('reads a carrier label with category 0 and the code as the target', () => {
    expect(parseScanCode(UPS, [BAG, SHOE, PARCEL])).toMatchObject({
      ok: true, parsed: { version: 18, category: '0', target: UPS }, scheme: { version: 18 },
    });
  });

  it('a prefixed code parses under its own scheme even when a pattern also matches it', () => {
    const loose = scheme({ version: 19, name: 'Any', encoding: 'pattern', patterns: ['.+'] });
    expect(parseScanCode('11:0:SF-A-2', [BAG, loose])).toMatchObject({ ok: true, parsed: { version: 11, target: 'SF-A-2' } });
  });

  it('a 12-digit UPC stays with the gtin scheme by default', () => {
    expect(parseScanCode('036000291452', [SHOE, PARCEL])).toMatchObject({ ok: true, parsed: { version: 16 } });
  });

  it('precedes_gtin reads a digits-only code with the pattern scheme first', () => {
    const first = { ...PARCEL, precedes_gtin: true };
    expect(parseScanCode('036000291452', [SHOE, first])).toMatchObject({
      ok: true, parsed: { version: 18, category: '0', target: '036000291452' },
    });
  });

  it('a digits-only code that fails the GTIN check digit falls to the pattern scheme', () => {
    expect(parseScanCode('036000291453', [SHOE, PARCEL])).toMatchObject({ ok: true, parsed: { version: 18 } });
  });

  it('matches the whole code only', () => {
    expect(parseScanCode(`${UPS}X`, [PARCEL]).ok).toBe(false);
    expect(parseScanCode(`X${UPS}`, [PARCEL]).ok).toBe(false);
  });

  it('the lowest version wins when two pattern schemes match', () => {
    const other = { ...PARCEL, version: 12, name: 'Other' };
    expect(parseScanCode(UPS, [PARCEL, other])).toMatchObject({ ok: true, parsed: { version: 12 } });
  });

  it('a disabled pattern scheme answers scheme_disabled when no enabled one matches', () => {
    expect(parseScanCode(UPS, [{ ...PARCEL, enabled: false }])).toMatchObject({ ok: false, failure: { reason: 'scheme_disabled' } });
  });

  it('a code no scheme reads keeps the prefixed failure', () => {
    expect(parseScanCode('ZZZ', [BAG, PARCEL])).toMatchObject({ ok: false, failure: { reason: 'unknown_version' } });
  });

  it('a pattern scheme rejects a code addressed to its version prefix', () => {
    expect(parseScanCode('18:0:ABC', [PARCEL])).toMatchObject({ ok: false, failure: { reason: 'malformed' } });
  });
});

describe('compilePattern / unanchorPattern', () => {
  it('anchors to the whole code, with or without declared anchors', () => {
    expect(compilePattern('^AB$')!.test('AB')).toBe(true);
    expect(compilePattern('AB')!.test('XAB')).toBe(false);
    expect(unanchorPattern('^1Z.+$')).toBe('1Z.+');
  });

  it('keeps an escaped trailing dollar', () => {
    expect(unanchorPattern('A\\$')).toBe('A\\$');
  });

  it('answers null for an expression that does not compile', () => {
    expect(compilePattern('[')).toBeNull();
  });
});

describe('pattern code length', () => {
  const ANY = scheme({ version: 19, name: 'Any', encoding: 'pattern', patterns: ['[A-Z0-9]+'] });

  it('reads a code up to the maximum length and skips a longer one', () => {
    expect(parseScanCode('A'.repeat(PATTERN_CODE_MAX_LENGTH), [ANY]).ok).toBe(true);
    expect(parseScanCode('A'.repeat(PATTERN_CODE_MAX_LENGTH + 1), [ANY]).ok).toBe(false);
  });

  it('bounds the cost of an expression that backtracks', () => {
    const slow = scheme({ version: 19, name: 'Slow', encoding: 'pattern', patterns: ['(A+)+B'] });
    const started = performance.now();
    expect(parseScanCode('A'.repeat(500), [slow]).ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
