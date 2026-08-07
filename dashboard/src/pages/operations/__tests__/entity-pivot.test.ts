import { describe, it, expect } from 'vitest';
import type { AggregateRow } from '../../../api/escalation-analytics';
import { rankSliceValues } from '../entity-pivot';

const row = (facets: Record<string, string>, dwellSeconds: number, state?: string): AggregateRow =>
  ({ facets, dwellSeconds, ...(state ? { state } : {}) }) as AggregateRow;

describe('rankSliceValues', () => {
  it('bundles state rows per slice value, ranked by total dwell', () => {
    const groups = [
      row({ facility: 'solo' }, 600, 'ready'),
      row({ facility: 'solo' }, 200, 'printing'),
      row({ facility: 'solitude' }, 300, 'ready'),
      row({ facility: 'empty' }, 0, 'ready'), // zero dwell dropped
    ];
    const ranked = rankSliceValues(groups, 'facility', 12);
    expect(ranked.map((r) => r.value)).toEqual(['solo', 'solitude']);
    expect(ranked[0].total).toBe(800);
    // Header groups are dwell-sorted within the value.
    expect(ranked[0].groups[0].state).toBe('ready');
  });

  it('caps the column set at the limit (a too-large facet is not a slice dimension)', () => {
    const groups = ['a', 'b', 'c'].map((v, i) => row({ facility: v }, 300 - i, 'ready'));
    expect(rankSliceValues(groups, 'facility', 2)).toHaveLength(2);
  });
});
