import { describe, it, expect } from 'vitest';

import {
  foldExtreme,
  isExtremeAggregate,
  relatedAggregateKey,
  relatedCountText,
  relatedValuePath,
} from '../../../shared/list-schema';

describe('relatedValuePath', () => {
  it('reads an item payload path on an items set', () => {
    expect(relatedValuePath('items', '{{item.payload.commitBy}}')).toBe('payload.commitBy');
    expect(relatedValuePath('items', '{{ item.payload.ship.by }}')).toBe('payload.ship.by');
  });

  it('reads a metadata key on a query set', () => {
    expect(relatedValuePath('query', '{{metadata.commitBy}}')).toBe('metadata.commitBy');
  });

  it('refuses a template that does not fit the source', () => {
    expect(relatedValuePath('items', '{{metadata.commitBy}}')).toBeNull();
    expect(relatedValuePath('query', '{{item.payload.commitBy}}')).toBeNull();
    expect(relatedValuePath('query', '{{metadata.a.b}}')).toBeNull();
    expect(relatedValuePath('items', 'Due {{item.payload.commitBy}}')).toBeNull();
    expect(relatedValuePath('items', undefined)).toBeNull();
  });
});

describe('relatedAggregateKey', () => {
  it('keys a count by its split and a min or max by its value path', () => {
    expect(relatedAggregateKey({}, 'items')).toBe('');
    expect(relatedAggregateKey({ aggregate: 'count', splitBy: 'role' }, 'query')).toBe('role');
    expect(relatedAggregateKey({ aggregate: 'min', value: '{{item.payload.commitBy}}' }, 'items')).toBe('min:payload.commitBy');
    expect(relatedAggregateKey({ aggregate: 'max', value: '{{metadata.due}}' }, 'query')).toBe('max:metadata.due');
    expect(isExtremeAggregate('count')).toBe(false);
  });
});

describe('relatedCountText', () => {
  const display = { '0': 'Ready', default: 'Waiting on {n}' };
  it('prefers the exact count, then the default with the count read in', () => {
    expect(relatedCountText(display, 0)).toBe('Ready');
    expect(relatedCountText(display, 3)).toBe('Waiting on 3');
    expect(relatedCountText({ '1': 'One left' }, 1)).toBe('One left');
  });

  it('is null without a display or a matching entry', () => {
    expect(relatedCountText(undefined, 0)).toBeNull();
    expect(relatedCountText({ '0': 'Ready' }, 2)).toBeNull();
  });
});

describe('foldExtreme', () => {
  it('compares numbers as numbers', () => {
    expect(foldExtreme('min', [10, 9, 100])).toBe(9);
    expect(foldExtreme('max', [10, 9, 100])).toBe(100);
  });

  it('compares anything else as text, so ISO instants order by time', () => {
    expect(foldExtreme('min', ['2026-10-21', '2026-10-09'])).toBe('2026-10-09');
    expect(foldExtreme('max', ['b', 'a', 10])).toBe('b');
    expect(foldExtreme('min', [])).toBeUndefined();
  });
});
