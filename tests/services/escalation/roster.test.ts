import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearch = vi.fn();
vi.mock('../../../services/escalation/queries', () => ({
  searchEscalationsFaceted: (...args: unknown[]) => mockSearch(...args),
}));

import { loadRosterCounts } from '../../../services/escalation/roster';

const SCHEMA = {
  properties: {
    orders: {
      'x-lt-widget': 'roster',
      'x-lt-roster': {
        expected: { query: { roles: ['packing'], facets: { box: '{{escalation.id}}' } } },
        key: '{{metadata.orderId}}',
        in: ['items', 'resolver.bags'],
        flagged: [{ when: 'resolver.outcome=missing', label: 'Missing' }],
      },
    },
    weight: { type: 'number' },
  },
};

const row = (id: string, orderId: string, resolver: unknown = null) =>
  ({ id, status: resolver ? 'resolved' : 'pending', metadata: { orderId }, resolver_payload: resolver });

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({
    escalations: [row('m1', 'o-1'), row('m2', 'o-2'), row('m3', 'o-3', { outcome: 'missing' })],
    total: 3,
  });
});

describe('loadRosterCounts', () => {
  it('reads member rows globally, every status, with the facets interpolated', async () => {
    await loadRosterCounts(SCHEMA, { escalation: { id: 'box-1' }, metadata: {} });
    const call = mockSearch.mock.calls[0][0];
    expect(call.global).toBe(true);
    expect(call.facet).toEqual({ roles: ['packing'], status: undefined, facets: { box: 'box-1' } });
    expect(call.limit).toBe(200);
  });

  it('counts held items and submitted form values in, flagged rows flagged', async () => {
    const counts = await loadRosterCounts(SCHEMA, {
      escalation: { id: 'box-1' },
      metadata: { accumulate_keys: ['o-1'] },
      resolver: { bags: ['o-2'] },
    });
    expect(counts).toEqual({ orders: { expected: 3, in: 2, flagged: 1, waiting: 0, outstanding: 0 } });
  });

  it('reads nothing for a schema with no roster', async () => {
    expect(await loadRosterCounts({ properties: { weight: { type: 'number' } } }, {})).toEqual({});
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('counts a list roster without a query', async () => {
    const schema = { properties: { bags: { 'x-lt-roster': { expected: { list: 'metadata.members' } } } } };
    const counts = await loadRosterCounts(schema, { metadata: { members: ['a', 'b'], accumulate_keys: ['a'] } });
    expect(counts.bags.outstanding).toBe(1);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
