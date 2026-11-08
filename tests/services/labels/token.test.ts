import { describe, it, expect } from 'vitest';

import { mintIdentityToken, DEFAULT_IDENTITY_TOKEN_LENGTH } from '../../../services/labels/token';
import { composeScanCode } from '../../../shared/labels/compose';

describe('mintIdentityToken', () => {
  it('mints 10 Crockford base32 characters by default for delimited schemes, distinct each time', () => {
    const a = mintIdentityToken({ encoding: 'delimited', target_length: null });
    const b = mintIdentityToken({ encoding: 'delimited', target_length: null });
    expect(DEFAULT_IDENTITY_TOKEN_LENGTH).toBe(10);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(a).not.toBe(b);
  });

  it('mints the scheme\'s target_length for delimited schemes, composable with the prefix', () => {
    const token = mintIdentityToken({ encoding: 'delimited', target_length: 12 });
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(composeScanCode({ version: 14, encoding: 'delimited', delimiter: ':', target_length: 12 }, '0', token)).toBe(`14:0:${token}`);
  });

  it('mints digits of the target length for fixed schemes, composable', () => {
    const token = mintIdentityToken({ encoding: 'fixed', target_length: 12 });
    expect(token).toMatch(/^\d{12}$/);
    expect(() => composeScanCode({ version: 30, encoding: 'fixed', delimiter: '', target_length: 12 }, '0', token)).not.toThrow();
  });

  it('refuses schemes the engine does not mint', () => {
    expect(() => mintIdentityToken({ encoding: 'gtin', target_length: null })).toThrow(/fixed and delimited/);
  });
});
