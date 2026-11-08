import { describe, it, expect } from 'vitest';

import { composeScanCode, isMintableScheme, ScanComposeError } from '../../../shared/labels/compose';
import { parseScanCode, type ParseableScheme } from '../../../shared/scan-code/parse';

const scheme = (over: Partial<ParseableScheme>): ParseableScheme => ({
  version: 14, name: 'Items', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, ...over,
});

describe('composeScanCode', () => {
  it('composes a delimited code that parses back to the same parts', () => {
    const s = scheme({});
    const code = composeScanCode(s, '1', 'A-3');
    expect(code).toBe('14:1:A-3');
    const parsed = parseScanCode(code, [s]);
    expect(parsed.ok && parsed.parsed).toEqual({ version: 14, category: '1', target: 'A-3' });
  });

  it('composes a fixed code that parses back', () => {
    const s = scheme({ version: 21, encoding: 'fixed', target_length: 6 });
    const code = composeScanCode(s, '3', '004512');
    expect(code).toBe('213004512');
    const parsed = parseScanCode(code, [s]);
    expect(parsed.ok && parsed.parsed).toEqual({ version: 21, category: '3', target: '004512' });
  });

  it('refuses a fixed target of the wrong length or with letters', () => {
    const s = scheme({ encoding: 'fixed', target_length: 4 });
    expect(() => composeScanCode(s, '0', '123')).toThrow(ScanComposeError);
    expect(() => composeScanCode(s, '0', '12a4')).toThrow(/exactly 4 digits/);
  });

  it('refuses an empty target or one with spaces', () => {
    expect(() => composeScanCode(scheme({}), '0', '')).toThrow(ScanComposeError);
    expect(() => composeScanCode(scheme({}), '0', 'SF A')).toThrow(/printable ASCII/);
  });

  it('refuses a category that is not one digit', () => {
    expect(() => composeScanCode(scheme({}), '12', 'X')).toThrow(/single digit/);
  });

  it('refuses schemes the engine only reads', () => {
    expect(() => composeScanCode(scheme({ encoding: 'gtin' }), '0', '00012345678905')).toThrow(/does not mint/);
    expect(() => composeScanCode(scheme({ encoding: 'pattern' }), '0', '1Z999')).toThrow(/does not mint/);
    expect(isMintableScheme({ encoding: 'gtin' })).toBe(false);
    expect(isMintableScheme({ encoding: 'fixed' })).toBe(true);
  });
});
