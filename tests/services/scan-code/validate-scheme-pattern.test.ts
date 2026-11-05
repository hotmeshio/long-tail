import { describe, it, expect } from 'vitest';

import { assertSchemesCoexist, assertValidScheme } from '../../../services/scan-code';
import type { ScanScheme } from '../../../types';

const PARCEL = { version: 18, name: 'Parcel', target_facet: 'trackingNumbers', encoding: 'pattern' as const, patterns: ['1Z[0-9A-Z]{16}'] };

describe('assertValidScheme — pattern encoding', () => {
  it('accepts a pattern scheme with a list target and gtin precedence', () => {
    expect(() => assertValidScheme({ ...PARCEL, target_match: 'member', precedes_gtin: true })).not.toThrow();
  });

  it('requires 1 to 10 patterns', () => {
    expect(() => assertValidScheme({ ...PARCEL, patterns: [] })).toThrow(/1 to 10 patterns/);
    expect(() => assertValidScheme({ ...PARCEL, patterns: Array(11).fill('A+') })).toThrow(/1 to 10 patterns/);
  });

  it('refuses a pattern that does not compile, matches an empty code, or runs too long', () => {
    expect(() => assertValidScheme({ ...PARCEL, patterns: ['['] })).toThrow(/not a valid regular expression/);
    expect(() => assertValidScheme({ ...PARCEL, patterns: ['A*'] })).toThrow(/matches an empty code/);
    expect(() => assertValidScheme({ ...PARCEL, patterns: ['A'.repeat(201)] })).toThrow(/exceeds 200 characters/);
    expect(() => assertValidScheme({ ...PARCEL, patterns: [''] })).toThrow(/non-empty string/);
  });

  it('keeps patterns and gtin precedence to pattern encoding', () => {
    const bag = { version: 11, name: 'Bag', target_facet: 'orderId', encoding: 'delimited' as const };
    expect(() => assertValidScheme({ ...bag, patterns: ['A+'] })).toThrow(/only to pattern encoding/);
    expect(() => assertValidScheme({ ...bag, precedes_gtin: true })).toThrow(/only to pattern encoding/);
  });
});

describe('assertValidScheme — target_match', () => {
  const bag = { version: 11, name: 'Bag', target_facet: 'orderIds', encoding: 'delimited' as const };

  it('accepts a list target on an action scheme', () => {
    expect(() => assertValidScheme({ ...bag, target_match: 'member' })).not.toThrow();
  });

  it('refuses an unknown value and a list target on an identity scheme', () => {
    expect(() => assertValidScheme({ ...bag, target_match: 'any' as any })).toThrow(/unknown target_match/);
    expect(() => assertValidScheme({
      ...bag, kind: 'identity', grant_ttl_seconds: 600, target_match: 'member',
    })).toThrow(/only to action schemes/);
  });
});

describe('assertSchemesCoexist — a pattern scheme beside a gtin scheme', () => {
  const stored = (over: Partial<ScanScheme>): ScanScheme => ({
    version: 16, name: 'Shoe', description: null, target_facet: 'upc', encoding: 'gtin', delimiter: ':',
    target_length: null, kind: 'action', grant_ttl_seconds: null, grant_max_uses: 0, grant_scope: 'action',
    enabled: true, patterns: [], precedes_gtin: null, target_match: 'value', ...over,
  });
  const gtin = stored({});
  const undeclared = stored({ version: 18, name: 'Parcel', encoding: 'pattern', patterns: ['[0-9]{12}'] });

  it('refuses a pattern scheme that leaves the order undeclared beside an enabled gtin scheme', () => {
    expect(() => assertSchemesCoexist(PARCEL, [gtin])).toThrow(/gtin scheme 16 \("Shoe"\).*precedes_gtin/);
  });

  it('accepts either declared order, a disabled side, or no gtin scheme at all', () => {
    expect(() => assertSchemesCoexist({ ...PARCEL, precedes_gtin: true }, [gtin])).not.toThrow();
    expect(() => assertSchemesCoexist({ ...PARCEL, precedes_gtin: false }, [gtin])).not.toThrow();
    expect(() => assertSchemesCoexist(PARCEL, [stored({ enabled: false })])).not.toThrow();
    expect(() => assertSchemesCoexist({ ...PARCEL, enabled: false }, [gtin])).not.toThrow();
    expect(() => assertSchemesCoexist(PARCEL, [])).not.toThrow();
  });

  it('refuses enabling a gtin scheme while a pattern scheme has not declared its order', () => {
    expect(() => assertSchemesCoexist({ version: 16, name: 'Shoe', target_facet: 'upc', encoding: 'gtin' }, [undeclared]))
      .toThrow(/pattern scheme 18 \("Parcel"\) has not declared precedes_gtin/);
    expect(() => assertSchemesCoexist({ version: 16, name: 'Shoe', target_facet: 'upc', encoding: 'gtin' }, [{ ...undeclared, precedes_gtin: false }]))
      .not.toThrow();
  });
});
