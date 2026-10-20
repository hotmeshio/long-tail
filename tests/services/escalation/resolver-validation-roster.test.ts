import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
const mockSearch = vi.fn();
vi.mock('../../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...args: any[]) => mockGetEnforcingRoles(...args),
  getEnforcedFormSchema: (...args: any[]) => mockGetEnforcedFormSchema(...args),
}));
vi.mock('../../../services/escalation/queries', () => ({
  searchEscalationsFaceted: (...args: unknown[]) => mockSearch(...args),
}));

import { checkResolverPayload } from '../../../services/escalation/resolver-validation';

// A box that must account for every order before it asks for a weight.
const SCHEMA = {
  required: ['weight'],
  'x-lt-submit-guard': { roster: 'orders', message: '{{count}} orders unaccounted for' },
  properties: {
    orders: {
      type: 'string',
      'x-lt-widget': 'roster',
      'x-lt-roster': {
        expected: { query: { role: 'packing', facets: { box: '{{escalation.id}}' } } },
        key: '{{metadata.orderId}}',
        in: ['items', 'resolver.bags'],
        flagged: [{ when: 'resolver.outcome=missing', label: 'Missing' }],
      },
    },
    bags: { type: 'array' },
    weight: { type: 'number', 'x-lt-showIf': 'roster.orders.outstanding=0' },
  },
};

const member = (orderId: string, resolver: unknown = null) => ({ id: `m-${orderId}`, metadata: { orderId }, resolver_payload: resolver });
const box = { id: 'box-1', role: 'boxing', metadata: { accumulate_keys: ['o-1'] }, envelope: null, escalation_payload: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEnforcingRoles.mockResolvedValue(new Set(['boxing']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
  mockSearch.mockResolvedValue({ escalations: [member('o-1'), member('o-2'), member('o-3')], total: 3 });
});

describe('checkResolverPayload with a roster', () => {
  it('rejects while an order is outstanding, and the hidden weight is not demanded', async () => {
    const report = await checkResolverPayload(box, { bags: ['o-2'] });
    expect(report!.violations).toEqual([{ field: '_submitGuard', message: '1 orders unaccounted for' }]);
  });

  it('demands the weight once every order is in or flagged', async () => {
    mockSearch.mockResolvedValue({
      escalations: [member('o-1'), member('o-2'), member('o-3', { outcome: 'missing' })],
      total: 3,
    });
    const report = await checkResolverPayload(box, { bags: ['o-2'] });
    expect(report!.violations).toEqual([{ field: 'weight', message: 'Required' }]);
    expect(await checkResolverPayload(box, { bags: ['o-2'], weight: 4.2 })).toBeNull();
  });

  it('reads no member rows when the role does not enforce', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    expect(await checkResolverPayload(box, {})).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
