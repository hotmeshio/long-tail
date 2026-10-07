import { describe, it, expect } from 'vitest';
import { lookupLabel } from '../lookup-label';

describe('lookupLabel', () => {
  it('names a pinned edition by number and a current ref as current', () => {
    expect(lookupLabel({ domain: 'catalog', key: 'materials', version: 2 })).toBe('catalog/materials v2');
    expect(lookupLabel({ domain: 'catalog', key: 'materials', version: 4, current: true })).toBe('catalog/materials (current)');
    expect(lookupLabel({ domain: 'catalog', key: 'ghost', version: null, current: true })).toBe('catalog/ghost (current)');
  });
});
