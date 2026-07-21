import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The cache exists to keep schema reads off the resolve hot path, so these
// tests assert QUERY COUNTS, not just values: repeat reads inside the TTL
// window must not touch the pool.
const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import {
  getEnforcingRoles,
  isEnforcingRole,
  getEnforcedFormSchema,
  invalidateRoleEnforcement,
} from '../../../services/role/enforcement-cache';

beforeEach(() => {
  vi.clearAllMocks();
  invalidateRoleEnforcement();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('enforcing-role set', () => {
  it('serves repeat reads from cache — one query per TTL window', async () => {
    mockQuery.mockResolvedValue({ rows: [{ role: 'station-a' }] });
    const first = await getEnforcingRoles();
    const second = await getEnforcingRoles();
    expect(first.has('station-a')).toBe(true);
    expect(second).toBe(first);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(await isEnforcingRole('station-a')).toBe(true);
    expect(await isEnforcingRole('station-b')).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the TTL elapses', async () => {
    vi.useFakeTimers();
    mockQuery.mockResolvedValue({ rows: [] });
    await getEnforcingRoles();
    vi.advanceTimersByTime(31_000);
    mockQuery.mockResolvedValue({ rows: [{ role: 'station-a' }] });
    const refreshed = await getEnforcingRoles();
    expect(refreshed.has('station-a')).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('refreshes immediately after invalidation', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect((await getEnforcingRoles()).size).toBe(0);
    invalidateRoleEnforcement('station-a');
    mockQuery.mockResolvedValue({ rows: [{ role: 'station-a' }] });
    expect((await getEnforcingRoles()).has('station-a')).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('enforced form schema', () => {
  const SCHEMA = { properties: { note: { type: 'string' } } };

  it('caches pinned snapshots indefinitely — immutable rows', async () => {
    vi.useFakeTimers();
    mockQuery.mockResolvedValue({ rows: [{ form_schema: SCHEMA }] });
    expect(await getEnforcedFormSchema('station-a', 3)).toEqual(SCHEMA);
    vi.advanceTimersByTime(10 * 60_000);
    expect(await getEnforcedFormSchema('station-a', 3)).toEqual(SCHEMA);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('caches the latest schema under the TTL and drops it on invalidation', async () => {
    mockQuery.mockResolvedValue({ rows: [{ form_schema: SCHEMA }] });
    expect(await getEnforcedFormSchema('station-a')).toEqual(SCHEMA);
    expect(await getEnforcedFormSchema('station-a')).toEqual(SCHEMA);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    invalidateRoleEnforcement('station-a');
    const evolved = { properties: { note: { type: 'string' }, extra: { type: 'number' } } };
    mockQuery.mockResolvedValue({ rows: [{ form_schema: evolved }] });
    expect(await getEnforcedFormSchema('station-a')).toEqual(evolved);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('falls through to the latest schema when a pin references a missing snapshot', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                       // snapshot miss
      .mockResolvedValueOnce({ rows: [{ form_schema: SCHEMA }] }); // latest
    expect(await getEnforcedFormSchema('station-a', 99)).toEqual(SCHEMA);
  });

  it('returns null for a role with no schema — nothing to enforce', async () => {
    mockQuery.mockResolvedValue({ rows: [{ form_schema: null }] });
    expect(await getEnforcedFormSchema('station-a')).toBeNull();
  });
});
