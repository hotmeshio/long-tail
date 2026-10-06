import { describe, it, expect } from 'vitest';

import { assertSchemesCoexist, assertValidScheme } from '../../../services/scan-code';
import type { ScanScheme } from '../../../types';

const stored = (over: Partial<ScanScheme>): ScanScheme => ({
  version: 11, name: 'Bag', description: null, target_facet: 'orderSlug', encoding: 'delimited',
  delimiter: ':', target_length: null, kind: 'action', grant_ttl_seconds: null, grant_max_uses: 0,
  grant_scope: 'action', enabled: true, ...over,
});

const GTIN = { version: 16, name: 'Shoe', target_facet: 'upc', encoding: 'gtin' as const };

describe('assertSchemesCoexist', () => {
  it('a gtin scheme beside delimited schemes is fine', () => {
    expect(() => assertSchemesCoexist(GTIN, [stored({})])).not.toThrow();
  });

  it('only one gtin scheme may exist', () => {
    expect(() => assertSchemesCoexist(GTIN, [stored({ version: 17, encoding: 'gtin' })]))
      .toThrow(/only one gtin scheme/);
  });

  it('refuses an enabled gtin scheme while a fixed scheme accepts a GTIN length', () => {
    const fixed = stored({ version: 20, name: 'Serial', encoding: 'fixed', target_length: 9 }); // 12 or 13 digits
    expect(() => assertSchemesCoexist(GTIN, [fixed])).toThrow(/fixed scheme 20/);
  });

  it('a disabled gtin scheme may sit beside a colliding fixed scheme', () => {
    const fixed = stored({ version: 20, encoding: 'fixed', target_length: 9 });
    expect(() => assertSchemesCoexist({ ...GTIN, enabled: false }, [fixed])).not.toThrow();
  });

  it('refuses a fixed scheme whose lengths collide with an enabled gtin scheme', () => {
    const gtin = stored({ version: 16, name: 'Shoe', encoding: 'gtin' });
    expect(() => assertSchemesCoexist({ version: 20, encoding: 'fixed', target_length: 10 }, [gtin]))
      .toThrow(/collides with gtin scheme 16/);
    expect(() => assertSchemesCoexist({ version: 20, encoding: 'fixed', target_length: 6 }, [gtin])).not.toThrow();
  });

  it('an update compares against the other schemes, not its own stored row', () => {
    expect(() => assertSchemesCoexist(GTIN, [stored({ version: 16, encoding: 'gtin' })])).not.toThrow();
  });
});

describe('assertValidScheme — gtin and grant scope', () => {
  it('accepts a gtin action scheme with no target_length', () => {
    expect(() => assertValidScheme(GTIN)).not.toThrow();
  });

  it('a gtin scheme cannot be an identity scheme', () => {
    expect(() => assertValidScheme({ ...GTIN, kind: 'identity', grant_ttl_seconds: 60 })).toThrow(/action schemes/);
  });

  it('grant_scope applies only to identity schemes and must be known', () => {
    const badge = { version: 12, name: 'Badge', target_facet: 'badge_id', encoding: 'delimited' as const, kind: 'identity' as const, grant_ttl_seconds: 60 };
    expect(() => assertValidScheme({ ...badge, grant_scope: 'subject' })).not.toThrow();
    expect(() => assertValidScheme({ ...badge, grant_scope: 'forever' as any })).toThrow(/unknown grant_scope/);
    expect(() => assertValidScheme({ ...GTIN, grant_scope: 'subject' })).toThrow(/only to identity/);
  });
});
