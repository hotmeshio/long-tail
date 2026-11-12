import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bulk cancel publishes no per-row event, so it asks the durable relay for a pass itself.

vi.mock('../../services/escalation', () => ({
  bulkCancelEscalations: vi.fn(),
}));
vi.mock('../../services/durable-provider', () => ({
  kickDurableRelay: vi.fn(),
}));
vi.mock('../../api/escalations/helpers', () => ({
  validateIds: vi.fn(),
  checkBulkPermission: vi.fn(),
  assertWriteAccess: vi.fn(),
}));

import * as escalationService from '../../services/escalation';
import { kickDurableRelay } from '../../services/durable-provider';
import { validateIds, checkBulkPermission } from '../../api/escalations/helpers';
import { bulkCancel } from '../../api/escalations/cancel';

const auth = { userId: 'u-1', role: 'admin' } as any;
const ids = ['esc-1', 'esc-2'];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateIds).mockReturnValue(true);
  vi.mocked(checkBulkPermission).mockResolvedValue({ allowed: true } as any);
  vi.mocked(escalationService.bulkCancelEscalations).mockResolvedValue({ cancelled: 2, skipped: 0 } as any);
});

describe('bulkCancel and the durable relay', () => {
  it('kicks the relay after cancelling', async () => {
    const result = await bulkCancel({ ids }, auth);
    expect(result).toEqual({ status: 200, data: { cancelled: 2, skipped: 0 } });
    expect(kickDurableRelay).toHaveBeenCalledTimes(1);
  });

  it('does not kick the relay when the ids are invalid', async () => {
    vi.mocked(validateIds).mockReturnValue(false);
    expect((await bulkCancel({ ids: [] }, auth)).status).toBe(400);
    expect(kickDurableRelay).not.toHaveBeenCalled();
  });

  it('does not kick the relay when the caller lacks permission', async () => {
    vi.mocked(checkBulkPermission).mockResolvedValue({ allowed: false, status: 403, error: 'denied' } as any);
    expect((await bulkCancel({ ids }, auth)).status).toBe(403);
    expect(escalationService.bulkCancelEscalations).not.toHaveBeenCalled();
    expect(kickDurableRelay).not.toHaveBeenCalled();
  });

  it('does not kick the relay when the cancel fails', async () => {
    vi.mocked(escalationService.bulkCancelEscalations).mockRejectedValue(new Error('db down'));
    expect(await bulkCancel({ ids }, auth)).toEqual({ status: 500, error: 'db down' });
    expect(kickDurableRelay).not.toHaveBeenCalled();
  });
});
