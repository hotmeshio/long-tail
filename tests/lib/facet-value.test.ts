import { describe, it, expect } from 'vitest';

import { hasFacetValue } from '../../lib/facet-value';

describe('hasFacetValue', () => {
  it('accepts a non-empty string and a non-empty list of non-empty strings', () => {
    expect(hasFacetValue('A')).toBe(true);
    expect(hasFacetValue(['A', 'B'])).toBe(true);
  });

  it('refuses an empty string, an empty list, a list with an empty or non-string member, and other types', () => {
    expect(hasFacetValue('')).toBe(false);
    expect(hasFacetValue([])).toBe(false);
    expect(hasFacetValue(['A', ''])).toBe(false);
    expect(hasFacetValue(['A', 7])).toBe(false);
    expect(hasFacetValue(undefined)).toBe(false);
    expect(hasFacetValue(7)).toBe(false);
  });
});
