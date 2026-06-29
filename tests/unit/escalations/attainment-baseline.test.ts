import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('../../../services/escalation/client', () => ({
  ensureEscalationCompatView: vi.fn().mockResolvedValue(undefined),
}));

import { setBaseline } from '../../../services/escalation/attainment';

const baselineCalls = () => mockQuery.mock.calls.filter((c) => /lt_role_baselines/.test(c[0] as string));

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ id: 'baseline-1', created_at: new Date('2026-06-28T00:00:00Z') }] });
});

describe('setBaseline', () => {
  it('captures the snapshot in ONE atomic INSERT … SELECT — no read-then-write', async () => {
    await setBaseline({ role: 'r', range: '1h', nowEpoch: 1_000_000, scope: { global: true } });
    const writes = baselineCalls();
    expect(writes).toHaveLength(1);
    const [sql] = writes[0];
    // The snapshot is computed inline (the inner aggregation, percentile_cont and all)
    // inside the same INSERT — proving there is no separate SELECT before the write.
    expect(sql).toMatch(/INSERT INTO lt_role_baselines/);
    expect(sql).toMatch(/percentile_cont/);
    expect(sql).toMatch(/jsonb_agg/);
  });

  it('returns the new baseline id and timestamp', async () => {
    const result = await setBaseline({ role: 'r', range: '1h', nowEpoch: 1_000_000, scope: { global: true } });
    expect(result.id).toBe('baseline-1');
    expect(result.createdAt).toEqual(new Date('2026-06-28T00:00:00Z'));
  });

  it('binds the label, range key, window, and creator', async () => {
    await setBaseline({
      role: 'r', range: '1h', nowEpoch: 1_000_000, label: 'pre-shift', createdBy: 'u-9', scope: { global: true },
    });
    const [, params] = baselineCalls()[0];
    expect(params).toContain('pre-shift');
    expect(params).toContain('1h');
    expect(params).toContain('u-9');
  });
});
