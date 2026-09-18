import { describe, it, expect } from 'vitest';
import { escalationItems, summarizePayload } from '../escalation-items';

describe('escalationItems', () => {
  it('reads an accumulator row in arrival order with count and max', () => {
    const view = escalationItems(
      { metadata: { accumulate_count: 2, accumulate_max: 4, accumulate_keys: ['b', 'a'] } },
      {
        accumulate_items: {
          b: { at: '2026-01-01T00:00:02Z', actor: 'u-2', reciprocalId: 'r-1' },
          a: { at: '2026-01-01T00:00:01Z', payload: { w: 1 } },
        },
      },
    );
    expect(view).toMatchObject({ kind: 'accumulate', count: 2, max: 4, pending: [] });
    expect(view!.items.map((i) => i.itemKey)).toEqual(['a', 'b']);
    expect(view!.items[0].payload).toEqual({ w: 1 });
    expect(view!.items[1]).toMatchObject({ actor: 'u-2', reciprocalId: 'r-1' });
  });

  it('reports an unbounded accumulator with max null', () => {
    const view = escalationItems({ metadata: { accumulate_max: null } }, { accumulate_items: {} });
    expect(view).toMatchObject({ kind: 'accumulate', count: 0, max: null, items: [] });
  });

  it('reads a batch row with pending keys and fill stamps', () => {
    const view = escalationItems(
      { metadata: { batch_pending: ['paint'], batch_keys: ['cut', 'weld', 'paint'] } },
      { batch_items: { weld: { ok: true }, cut: { ok: false } }, batch_filled_at: { cut: '2026-01-01T00:00:01Z', weld: '2026-01-01T00:00:02Z' } },
    );
    expect(view).toMatchObject({ kind: 'batch', count: 2, max: 3, pending: ['paint'] });
    expect(view!.items.map((i) => i.itemKey)).toEqual(['cut', 'weld']);
  });

  it('returns null for a row without items', () => {
    expect(escalationItems({ metadata: { orderId: 'x' } }, { instructions: 'y' })).toBeNull();
    expect(escalationItems({ metadata: null }, null)).toBeNull();
  });
});

describe('summarizePayload', () => {
  it('shows up to three fields and counts the rest', () => {
    expect(summarizePayload({ a: 1, b: 'two', c: { d: 3 }, e: 5 })).toBe('a: 1 · b: two · c: {"d":3} · +1');
    expect(summarizePayload(undefined)).toBe('');
  });
});
