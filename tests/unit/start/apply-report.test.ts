import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWarn = vi.fn();
const mockInfo = vi.fn();
vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { warn: (...a: any[]) => mockWarn(...a), info: (...a: any[]) => mockInfo(...a) },
}));

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockRelease = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ connect: async () => ({ query: mockQuery, release: mockRelease }) }),
}));

import {
  ownedByCode,
  newSurfaceReport,
  recordOutcome,
  logSurfaceReport,
  withConfigLock,
} from '../../../start/apply-report';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ownedByCode', () => {
  it('the per-entry reset flag wins in either direction; configSource decides otherwise', () => {
    expect(ownedByCode(undefined, 'db')).toBe(false);
    expect(ownedByCode(undefined, 'code')).toBe(true);
    expect(ownedByCode(true, 'db')).toBe(true);
    expect(ownedByCode(false, 'code')).toBe(false);
  });
});

describe('surface reports', () => {
  it('tallies outcomes into the right buckets', () => {
    const report = newSurfaceReport();
    recordOutcome(report, 'a', 'applied');
    recordOutcome(report, 'b', 'unchanged');
    recordOutcome(report, 'c', 'db-owned');
    expect(report).toEqual({ applied: ['a'], unchanged: ['b'], dbOwned: ['c'], orphans: [] });
  });

  it('logs info without orphans, warn with them', () => {
    const clean = newSurfaceReport();
    recordOutcome(clean, 'a', 'applied');
    logSurfaceReport('workflows', clean);
    expect(mockInfo).toHaveBeenCalledWith(
      '[long-tail] config apply (workflows): applied 1, unchanged 0, db-owned 0',
    );

    const drifted = { ...newSurfaceReport(), orphans: ['oldFlow', 'goneRole'] };
    logSurfaceReport('roles', drifted);
    expect(mockWarn).toHaveBeenCalledWith(
      '[long-tail] config apply (roles): applied 0, unchanged 0, db-owned 0, orphans: [oldFlow, goneRole]',
    );
  });
});

describe('withConfigLock', () => {
  it('acquires and releases the advisory lock around the callback', async () => {
    const result = await withConfigLock(async () => 'done');
    expect(result).toBe('done');
    expect(mockQuery.mock.calls[0][0]).toContain('pg_advisory_lock');
    expect(mockQuery.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when the callback throws', async () => {
    await expect(withConfigLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(mockQuery.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
