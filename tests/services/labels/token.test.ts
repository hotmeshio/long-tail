import { describe, it, expect } from 'vitest';

import { mintIdentityToken, DELIMITED_TOKEN_LENGTH } from '../../../services/labels/token';
import { composeScanCode } from '../../../shared/labels/compose';

describe('mintIdentityToken', () => {
  it('mints Crockford base32 for delimited schemes, distinct each time', () => {
    const a = mintIdentityToken({ encoding: 'delimited', target_length: null });
    const b = mintIdentityToken({ encoding: 'delimited', target_length: null });
    expect(a).toMatch(new RegExp(`^[0-9A-HJKMNP-TV-Z]{${DELIMITED_TOKEN_LENGTH}}$`));
    expect(a).not.toBe(b);
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
