import { describe, it, expect, vi } from 'vitest';

const ensureView = vi.fn();
const poolQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../../../services/escalation/client', () => ({
  ensureEscalationCompatView: () => ensureView(),
}));
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: poolQuery }),
}));

import { ensureFacetReady } from '../../../services/escalation/facets';

describe('ensureFacetReady', () => {
  it('retries after a failure and caches only success', async () => {
    ensureView.mockRejectedValueOnce(new Error('Connection terminated unexpectedly')).mockResolvedValue(undefined);
    await expect(ensureFacetReady()).rejects.toThrow('Connection terminated unexpectedly');
    await expect(ensureFacetReady()).resolves.toBeUndefined();
    await ensureFacetReady();
    expect(ensureView).toHaveBeenCalledTimes(2);
  });
});
