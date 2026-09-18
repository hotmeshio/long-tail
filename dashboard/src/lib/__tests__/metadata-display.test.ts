import { describe, it, expect } from 'vitest';
import { displayMetadataEntries } from '../metadata-display';

describe('displayMetadataEntries', () => {
  it('hides platform plumbing and underscore keys while keeping facets', () => {
    const entries = displayMetadataEntries({
      orderId: 'o-1',
      form_schema: {},
      batch_keys: ['a'],
      accumulate_keys: ['a'],
      accumulate_count: 1,
      accumulate_max: 4,
      _internal: true,
    });
    expect(entries.map(([k]) => k)).toEqual(['orderId', 'accumulate_count', 'accumulate_max']);
  });

  it('tolerates a missing bag', () => {
    expect(displayMetadataEntries(null)).toEqual([]);
  });
});
