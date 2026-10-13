import { describe, it, expect } from 'vitest';
import { displayMetadataEntries, stationFactEntries } from '../metadata-display';

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

describe('stationFactEntries', () => {
  it('drops scan provenance, resolution stamps and counters, keeping the row facts', () => {
    const entries = stationFactEntries({
      binCode: 'SF-A-2', facilityName: 'Acme East',
      scannedAt: '2026-10-06T00:00:00Z', scanScheme: 14, scanCategory: '1', scanStation: 'u', scanActionName: 'Pack It',
      resolved_by: 'u', schema_version: 3, accumulate_max: 4, accumulate_count: 1, form_schema: {},
    });
    expect(entries.map(([k]) => k)).toEqual(['binCode', 'facilityName']);
  });
});
