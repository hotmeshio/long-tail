import { describe, it, expect } from 'vitest';

import { facetHolds, facetTarget } from '../../../shared/scan-code';

describe('facetHolds', () => {
  it('matches a value equal to the target', () => {
    expect(facetHolds('A', 'A')).toBe(true);
    expect(facetHolds('A', 'B')).toBe(false);
  });

  it('matches a list containing the target', () => {
    expect(facetHolds(['A', 'B'], 'B')).toBe(true);
    expect(facetHolds(['A', 'B'], 'C')).toBe(false);
  });

  it('never matches an absent facet', () => {
    expect(facetHolds(undefined, 'A')).toBe(false);
    expect(facetHolds(null, 'A')).toBe(false);
  });
});

describe('facetTarget', () => {
  it('names a value, or the first member of a list', () => {
    expect(facetTarget('A')).toBe('A');
    expect(facetTarget(['B', 'C'])).toBe('B');
  });

  it('answers null for an empty, absent, or non-string facet', () => {
    expect(facetTarget('')).toBeNull();
    expect(facetTarget([])).toBeNull();
    expect(facetTarget(undefined)).toBeNull();
    expect(facetTarget(7)).toBeNull();
  });
});
