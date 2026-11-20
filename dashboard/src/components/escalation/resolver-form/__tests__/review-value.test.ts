import { describe, it, expect } from 'vitest';
import { formatReviewValue } from '../review-value';

const CONDITIONS = {
  type: 'array',
  items: { type: 'string' },
  'x-lt-options': [{ value: 'neuropathy', label: 'Peripheral neuropathy' }],
};
const LINES = {
  type: 'array',
  items: { type: 'object', properties: { code: { type: 'string', title: 'Code' }, qty: { type: 'integer', title: 'Qty' } } },
};

describe('formatReviewValue for lists', () => {
  it('uses option labels for list items', () => {
    expect(formatReviewValue(['neuropathy', 'other'], CONDITIONS, undefined)).toBe('Peripheral neuropathy; other');
  });

  it('reads null as not stated and an empty list as none', () => {
    expect(formatReviewValue(null, CONDITIONS, undefined)).toBe('Not stated');
    expect(formatReviewValue([], CONDITIONS, undefined)).toBe('None');
  });

  it('writes a row as its labeled cells, never raw JSON', () => {
    expect(formatReviewValue([{ code: 'A5500', qty: 2 }], LINES, undefined)).toBe('Code A5500, Qty 2');
  });

  it('writes a row by its item title when declared', () => {
    const schema = { ...LINES, 'x-lt-item-title': 'quote' };
    expect(formatReviewValue([{ quote: 'Callus noted', status: 'current' }], schema, undefined)).toBe('Callus noted');
  });

  it('keeps the scalar form unchanged', () => {
    expect(formatReviewValue('', { type: 'string' }, undefined)).toBe('empty');
    expect(formatReviewValue(true, { type: 'boolean' }, undefined)).toBe('Yes');
    expect(formatReviewValue(null, { type: 'string' }, undefined)).toBe('empty');
  });
});
