import { describe, it, expect } from 'vitest';

import { assertValidScheme } from '../../../services/scan-code/validate';

const badge = (target_length: number | null) => ({
  version: 14, name: 'Badge', target_facet: 'badge_id', encoding: 'delimited' as const, delimiter: ':',
  kind: 'identity' as const, grant_ttl_seconds: 300, grant_max_uses: 1, target_length,
});

describe('generated badge length on a delimited identity scheme', () => {
  it('may be left unset (the default applies) or set from 8 to 64', () => {
    expect(() => assertValidScheme(badge(null))).not.toThrow();
    expect(() => assertValidScheme(badge(8))).not.toThrow();
    expect(() => assertValidScheme(badge(64))).not.toThrow();
  });

  it('refuses lengths outside 8 to 64', () => {
    expect(() => assertValidScheme(badge(7))).toThrow(/8 to 64/);
    expect(() => assertValidScheme(badge(65))).toThrow(/8 to 64/);
    expect(() => assertValidScheme(badge(9.5))).toThrow(/8 to 64/);
  });

  it('leaves action schemes alone', () => {
    expect(() => assertValidScheme({ version: 14, name: 'Items', target_facet: 'itemKey', encoding: 'delimited', delimiter: ':', target_length: 3 })).not.toThrow();
  });
});
