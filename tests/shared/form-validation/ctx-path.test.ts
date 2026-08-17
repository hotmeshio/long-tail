import { describe, it, expect } from 'vitest';

import {
  hasInterpolation,
  interpolatePath,
  resolveCtxPath,
} from '../../../shared/form-validation';

// ctx-path — the shared "domain.path" walk plus {{domain.path}} interpolation
// that powers cascading selects. An unresolved segment means "no concrete
// path yet", never a literal placeholder.

const CTX = {
  lookup: {
    geo: {
      countries: ['US', 'EU'],
      regions: { US: ['CA', 'NY'], EU: ['DE', 'FR'] },
    },
  },
  resolver: { country: 'US', size: 2, note: '', flag: true },
};

describe('hasInterpolation', () => {
  it('detects {{...}} segments; plain paths and non-strings read false', () => {
    expect(hasInterpolation('lookup.geo.regions.{{resolver.country}}')).toBe(true);
    expect(hasInterpolation('lookup.geo.countries')).toBe(false);
    expect(hasInterpolation(42)).toBe(false);
    expect(hasInterpolation(undefined)).toBe(false);
  });
});

describe('resolveCtxPath', () => {
  it('walks domain.path with nested keys and array indices', () => {
    expect(resolveCtxPath('lookup.geo.regions.US', CTX)).toEqual(['CA', 'NY']);
    expect(resolveCtxPath('lookup.geo.countries[1]', CTX)).toBe('EU');
    expect(resolveCtxPath('resolver.country', CTX)).toBe('US');
    expect(resolveCtxPath('lookup.missing.path', CTX)).toBeUndefined();
    expect(resolveCtxPath('ghost.path', CTX)).toBeUndefined();
    expect(resolveCtxPath('resolver.country', undefined)).toBeUndefined();
  });
});

describe('interpolatePath', () => {
  it('substitutes scalar answers into the path', () => {
    expect(interpolatePath('lookup.geo.regions.{{resolver.country}}', CTX))
      .toBe('lookup.geo.regions.US');
    expect(interpolatePath('a.{{resolver.size}}.b', CTX)).toBe('a.2.b');
  });

  it('answers null while any segment is unresolved — missing, empty, or non-scalar', () => {
    expect(interpolatePath('x.{{resolver.absent}}', CTX)).toBeNull();
    expect(interpolatePath('x.{{resolver.note}}', CTX)).toBeNull();
    expect(interpolatePath('x.{{resolver.flag}}', CTX)).toBeNull();
    expect(interpolatePath('x.{{lookup.geo.regions}}', CTX)).toBeNull();
    expect(interpolatePath('x.{{resolver.country}}', undefined)).toBeNull();
  });

  it('resolves multiple segments in one path', () => {
    expect(interpolatePath('{{resolver.country}}.{{resolver.size}}', CTX)).toBe('US.2');
  });
});
