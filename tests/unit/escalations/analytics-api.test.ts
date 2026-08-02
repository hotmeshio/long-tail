import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  AnalyticsInputError: class AnalyticsInputError extends Error {
    readonly status = 400;
  },
  aggregateByFacets: vi.fn(),
  timelineByFacet: vi.fn(),
  resolveEntitySystem: vi.fn(),
}));
vi.mock('../../../services/user', () => ({
  hasGlobalEscalationAccess: vi.fn(),
  getRoleScope: vi.fn(),
}));
vi.mock('../../../modules/features', () => ({
  getFeatureFlags: vi.fn(() => ({ publicPaceBoard: false })),
}));

import * as escalationService from '../../../services/escalation';
import * as userService from '../../../services/user';
import { getFeatureFlags } from '../../../modules/features';
import { aggregateByFacets, timelineByFacet } from '../../../api/escalations/analytics';

const svc = vi.mocked(escalationService);
const users = vi.mocked(userService);
const flags = vi.mocked(getFeatureFlags);
const auth = { userId: 'user-1' } as any;

const countsOnly = { query: { roles: ['a', 'b'] }, groupBy: { state: true }, measure: { kind: 'membership' } } as any;
const facetKeyed = { query: { roles: ['a'] }, groupBy: { facets: ['serialNumber'] }, measure: { kind: 'membership' } } as any;

beforeEach(() => {
  vi.clearAllMocks();
  flags.mockReturnValue({ publicPaceBoard: false } as any);
  svc.aggregateByFacets.mockResolvedValue({ groups: [], overflow: false });
  svc.timelineByFacet.mockResolvedValue({ intervals: [], overflow: false });
  users.hasGlobalEscalationAccess.mockResolvedValue(false);
  users.getRoleScope.mockResolvedValue({ read: 'all', write: 'all' } as any);
});

describe('aggregateByFacets — the read gate', () => {
  it('requires read_all on EVERY role in the filter', async () => {
    users.getRoleScope.mockImplementation(async (_u: string, role: string) =>
      role === 'a' ? ({ read: 'all' } as any) : ({ read: 'self' } as any),
    );
    const result = await aggregateByFacets(countsOnly, auth);
    expect(result.status).toBe(403);
    expect(svc.aggregateByFacets).not.toHaveBeenCalled();
  });

  it('passes with read_all on every role', async () => {
    const result = await aggregateByFacets(countsOnly, auth);
    expect(result.status).toBe(200);
  });

  it('a roleless query spans every pond and requires a global principal', async () => {
    const roleless = { query: {}, groupBy: {}, measure: { kind: 'membership' } } as any;
    expect((await aggregateByFacets(roleless, auth)).status).toBe(403);

    users.hasGlobalEscalationAccess.mockResolvedValue(true);
    expect((await aggregateByFacets(roleless, auth)).status).toBe(200);
  });

  it('resolves query.entity to its system BEFORE the gate, covering the touched roles', async () => {
    svc.resolveEntitySystem.mockResolvedValue([
      { role: 'printer-fleet', source: 'subtype' },
      { role: 'printer-service', source: 'role' },
    ]);
    users.getRoleScope.mockImplementation(async (_u: string, role: string) =>
      role === 'printer-service' ? ({ read: 'self' } as any) : ({ read: 'all' } as any),
    );
    const input = { query: { entity: 'serialNumber' }, groupBy: { state: true }, measure: { kind: 'membership' } } as any;
    const result = await aggregateByFacets(input, auth);
    expect(result.status).toBe(403);
    expect(result.error).toContain('printer-service');
  });

  it('an unknown entity key is a 400 naming the configuration gap, before any scope answer', async () => {
    svc.resolveEntitySystem.mockRejectedValue(
      new (escalationService as any).AnalyticsInputError('no roles declare entity_facet "serialNumber"'),
    );
    const input = { query: { entity: 'serialNumber' }, groupBy: {}, measure: { kind: 'membership' } } as any;
    const result = await aggregateByFacets(input, auth);
    expect(result.status).toBe(400);
    expect(result.error).toContain('no roles declare');
  });

  it('publicPaceBoard opens counts-only groupings to any login; facet groupings stay gated', async () => {
    flags.mockReturnValue({ publicPaceBoard: true } as any);
    users.getRoleScope.mockResolvedValue({ read: 'self' } as any);

    expect((await aggregateByFacets(countsOnly, auth)).status).toBe(200);
    expect((await aggregateByFacets(facetKeyed, auth)).status).toBe(403);
  });

  it('maps AnalyticsInputError to 400 and unknown errors to 500', async () => {
    svc.aggregateByFacets.mockRejectedValue(
      new (escalationService as any).AnalyticsInputError('bad input'),
    );
    expect((await aggregateByFacets(countsOnly, auth)).status).toBe(400);

    svc.aggregateByFacets.mockRejectedValue(new Error('db down'));
    expect((await aggregateByFacets(countsOnly, auth)).status).toBe(500);
  });
});

describe('timelineByFacet — always the full gate', () => {
  const input = { facet: { key: 'serialNumber', value: 'SN-1' }, query: { roles: ['a'] } } as any;

  it('publicPaceBoard never opens the timeline — movement history is item-level disclosure', async () => {
    flags.mockReturnValue({ publicPaceBoard: true } as any);
    users.getRoleScope.mockResolvedValue({ read: 'self' } as any);
    expect((await timelineByFacet(input, auth)).status).toBe(403);
  });

  it('passes with read_all and returns the intervals', async () => {
    const result = await timelineByFacet(input, auth);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ intervals: [], overflow: false });
  });

  it('a roleless timeline requires a global principal', async () => {
    const roleless = { facet: { key: 'serialNumber', value: 'SN-1' } } as any;
    expect((await timelineByFacet(roleless, auth)).status).toBe(403);
    users.hasGlobalEscalationAccess.mockResolvedValue(true);
    expect((await timelineByFacet(roleless, auth)).status).toBe(200);
  });
});
