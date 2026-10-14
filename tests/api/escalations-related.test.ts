import { describe, it, expect, vi, beforeEach } from 'vitest';

// The related endpoints read the declaration from the role's stored list
// schema, gate the host role, and pass the caller's scope to every statement.
const readScope = vi.fn();
vi.mock('../../api/escalations/helpers', () => ({ getEscalationReadScope: (...a: unknown[]) => readScope(...a) }));
vi.mock('../../services/role', () => ({
  getRoleListSchema: vi.fn(),
  listRolesWithDetails: vi.fn(),
}));
vi.mock('../../services/escalation', () => ({
  readRelatedHosts: vi.fn(),
  aggregateRelatedItems: vi.fn(),
  aggregateRelatedQuery: vi.fn(),
  listRelatedItems: vi.fn(),
  listRelatedQueryRows: vi.fn(),
}));

import * as roleService from '../../services/role';
import * as escalationService from '../../services/escalation';
import { getRelatedAggregates, getRelatedRows } from '../../api/escalations/related';

const auth = { userId: '66666666-6666-4666-8666-666666666666' };
const H1 = '11111111-1111-4111-8111-111111111111';
const H2 = '22222222-2222-4222-8222-222222222222';
const schema = {
  'x-lt-related': {
    contents: { source: 'items' },
    coming: { source: 'query', query: { segment: 'prep', facets: { destination: '{{metadata.destination}}' } } },
  },
  'x-lt-columns': [
    { label: 'Holds', related: 'contents', splitBy: 'reciprocal.metadata.serviceLevel' },
    { label: 'Total', related: 'contents' },
    { label: 'Coming', related: 'coming', splitBy: 'role' },
  ],
};
const roles = [
  { role: 'prep', title: 'Prep', parent_role: null, ops_visible: true },
  { role: 'check', title: null, parent_role: 'prep', ops_visible: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  readScope.mockResolvedValue({ global: false, allRoles: ['bin', 'prep'], selfRoles: [] });
  vi.mocked(roleService.getRoleListSchema).mockResolvedValue({ version: 3, list_schema: schema } as any);
  vi.mocked(roleService.listRolesWithDetails).mockResolvedValue(roles as any);
  vi.mocked(escalationService.readRelatedHosts).mockResolvedValue([
    { id: H1, role: 'bin', metadata: { destination: 'north' } },
    { id: H2, role: 'bin', metadata: {} },
  ] as any);
  vi.mocked(escalationService.aggregateRelatedItems).mockResolvedValue({ aggregates: { [H1]: { count: 2 } }, roles: ['stage'] });
  vi.mocked(escalationService.aggregateRelatedQuery).mockResolvedValue({ [H1]: { count: 1, splits: { prep: 1 } } } as any);
});

describe('getRelatedAggregates', () => {
  it('runs one statement per (set, split) under the caller scope', async () => {
    const result = await getRelatedAggregates({ role: 'bin', ids: [H1, H2, 'junk'] }, auth);
    expect(result.status).toBe(200);
    const items = vi.mocked(escalationService.aggregateRelatedItems).mock.calls.map((c) => c[0].splitBy);
    expect(items).toEqual(['reciprocal.metadata.serviceLevel', undefined]);
    expect(vi.mocked(escalationService.readRelatedHosts).mock.calls[0][0]).toMatchObject({
      ids: [H1, H2], role: 'bin', scope: { global: false, visibleRoles: ['bin', 'prep'], meUserId: auth.userId },
    });
    const query = vi.mocked(escalationService.aggregateRelatedQuery).mock.calls[0][0];
    expect(query).toMatchObject({ roles: ['prep', 'check'], status: 'pending', splitBy: 'role', hosts: [{ hostId: H1, match: { destination: 'north' } }] });
    const coming = result.data.sets.coming;
    expect(coming).toMatchObject({ roles: ['prep', 'check'], roleLabels: { prep: 'Prep', check: 'check' }, restricted: ['check'] });
    expect(coming.aggregates.role[H2]).toEqual({ count: 0, unresolved: true });
    expect(result.data.sets.contents).toMatchObject({ source: 'items', roles: ['stage'], aggregates: { '': { [H1]: { count: 2 } } } });
    expect(result.data.version).toBe(3);
  });

  it('hides a role the caller cannot read behind a 404', async () => {
    readScope.mockResolvedValue({ global: false, allRoles: ['prep'], selfRoles: [] });
    expect((await getRelatedAggregates({ role: 'bin', ids: [H1] }, auth)).status).toBe(404);
    expect(roleService.getRoleListSchema).not.toHaveBeenCalled();
  });

  it('reads the version the caller rendered', async () => {
    await getRelatedAggregates({ role: 'bin', ids: [H1], version: 2 }, auth);
    expect(roleService.getRoleListSchema).toHaveBeenCalledWith('bin', 2);
  });

  it('refuses oversized pages and bad versions', async () => {
    const ids = Array.from({ length: 101 }, () => H1);
    expect((await getRelatedAggregates({ role: 'bin', ids }, auth)).status).toBe(400);
    expect((await getRelatedAggregates({ role: 'bin', ids: [H1], version: 0 }, auth)).status).toBe(400);
    expect((await getRelatedAggregates({ role: 'bin', ids: 'x' as any }, auth)).status).toBe(400);
  });

  it('names a segment that resolves to no sequence', async () => {
    vi.mocked(roleService.listRolesWithDetails).mockResolvedValue([] as any);
    const result = await getRelatedAggregates({ role: 'bin', ids: [H1] }, auth);
    expect(result).toEqual({ status: 400, error: 'x-lt-related.coming: segment "prep" names no Pace Board sequence' });
  });

  it('answers a stored schema that no longer validates with a 422', async () => {
    vi.mocked(roleService.getRoleListSchema).mockResolvedValue({ version: 1, list_schema: { 'x-lt-related': {} } } as any);
    expect((await getRelatedAggregates({ role: 'bin', ids: [H1] }, auth)).status).toBe(422);
  });
});

describe('getRelatedRows', () => {
  it('lists one host items with the default limit', async () => {
    vi.mocked(escalationService.listRelatedItems).mockResolvedValue({ rows: [], total: 0 });
    const result = await getRelatedRows({ role: 'bin', id: H1, set: 'contents' }, auth);
    expect(result.status).toBe(200);
    expect(vi.mocked(escalationService.listRelatedItems).mock.calls[0][0]).toMatchObject({ hostId: H1, limit: 25 });
  });

  it('lists a query set with the host facets, and none when they do not resolve', async () => {
    vi.mocked(escalationService.listRelatedQueryRows).mockResolvedValue({ rows: [], total: 0 });
    vi.mocked(escalationService.readRelatedHosts).mockResolvedValueOnce([{ id: H1, metadata: { destination: 'north' } }] as any);
    const result = await getRelatedRows({ role: 'bin', id: H1, set: 'coming', limit: 5 }, auth);
    expect(result.data).toMatchObject({ source: 'query', restricted: ['check'] });
    expect(vi.mocked(escalationService.listRelatedQueryRows).mock.calls[0][0]).toMatchObject({
      hosts: [{ hostId: H1, match: { destination: 'north' } }], limit: 5,
    });
    vi.mocked(escalationService.readRelatedHosts).mockResolvedValueOnce([{ id: H2, metadata: {} }] as any);
    const empty = await getRelatedRows({ role: 'bin', id: H2, set: 'coming' }, auth);
    expect(empty.data).toMatchObject({ rows: [], total: 0 });
    expect(escalationService.listRelatedQueryRows).toHaveBeenCalledTimes(1);
  });

  it('404s an unknown set, an unreadable host, and refuses bad input', async () => {
    expect((await getRelatedRows({ role: 'bin', id: H1, set: 'nope' }, auth)).status).toBe(404);
    vi.mocked(escalationService.readRelatedHosts).mockResolvedValueOnce([]);
    expect((await getRelatedRows({ role: 'bin', id: H1, set: 'contents' }, auth)).status).toBe(404);
    expect((await getRelatedRows({ role: 'bin', id: 'x', set: 'contents' }, auth)).status).toBe(400);
    expect((await getRelatedRows({ role: 'bin', id: H1, set: 'contents', limit: 500 }, auth)).status).toBe(400);
  });
});
