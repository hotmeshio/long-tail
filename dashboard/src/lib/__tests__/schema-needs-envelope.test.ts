import { describe, it, expect } from 'vitest';
import { schemaNeedsEnvelope } from '../schema-needs-envelope';

// The list opt-in: only fragments interpolating envelope./payload. pull the
// heavyweight columns back onto list rows.

describe('schemaNeedsEnvelope', () => {
  it('matches envelope and payload interpolations anywhere in the fragment', () => {
    expect(schemaNeedsEnvelope({ 'x-lt-columns': [{ value: '{{envelope.data.order}}' }] })).toBe(true);
    expect(schemaNeedsEnvelope({ row: { subtitle: '{{payload.note}}' } })).toBe(true);
    expect(schemaNeedsEnvelope({ 'x-lt-source': 'envelope.checklist_items' })).toBe(true);
  });

  it('metadata and resolver interpolations ride the slim rows', () => {
    expect(schemaNeedsEnvelope({ columns: [{ value: '{{metadata.order}}' }] })).toBe(false);
    expect(schemaNeedsEnvelope({ columns: [{ value: '{{resolver.outcome}}' }] })).toBe(false);
  });

  it('empty and absent fragments never opt in', () => {
    expect(schemaNeedsEnvelope(null)).toBe(false);
    expect(schemaNeedsEnvelope(undefined)).toBe(false);
    expect(schemaNeedsEnvelope({})).toBe(false);
  });
});
