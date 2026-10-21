import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation', () => ({
  getEscalation: vi.fn(), flagBatchItem: vi.fn(), unflagBatchItem: vi.fn(),
}));
vi.mock('../../api/escalations/helpers', () => ({ assertReadAccess: vi.fn(), assertWriteAccess: vi.fn() }));
vi.mock('../../api/escalations/resolve', () => ({ resolverIdentity: vi.fn(async (a: any) => ({ id: a.userId })) }));

import * as escalationService from '../../services/escalation';
import { assertReadAccess, assertWriteAccess } from '../../api/escalations/helpers';
import { flagBatchItem, unflagBatchItem, wakesOnFlag } from '../../api/escalations/batch-flag';

const auth = { userId: 'u-1' };
const row = (envelope = '{}') => ({ id: 'e-1', workflow_id: 'wf-1', envelope }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(escalationService.getEscalation).mockResolvedValue(row());
  vi.mocked(assertReadAccess).mockResolvedValue(null as any);
  vi.mocked(assertWriteAccess).mockResolvedValue(null as any);
  vi.mocked(escalationService.flagBatchItem).mockResolvedValue({ outcome: 'flagged', escalation: {} as any });
  vi.mocked(escalationService.unflagBatchItem).mockResolvedValue({ outcome: 'unflagged', escalation: {} as any });
});

describe('flagBatchItem', () => {
  it('flags as the caller, without a resolver stamp on a wait that continues', async () => {
    const result = await flagBatchItem({ id: 'e-1', itemKey: 'k', label: 'Missing', payload: { note: 'x' } }, auth);
    expect(result).toMatchObject({ status: 200, data: { outcome: 'flagged', itemKey: 'k' } });
    expect(escalationService.flagBatchItem).toHaveBeenCalledWith('e-1', 'k', { label: 'Missing', payload: { note: 'x' }, actor: 'u-1' });
  });

  it('stamps the resolver when the flag ends a wakeOnFlag wait', async () => {
    vi.mocked(escalationService.getEscalation).mockResolvedValue(row('{"batch_wake_on_flag":true}'));
    vi.mocked(escalationService.flagBatchItem).mockResolvedValue({ outcome: 'completed', escalation: {} as any });
    const result = await flagBatchItem({ id: 'e-1', itemKey: 'k', label: 'Missing' }, auth);
    expect(result).toMatchObject({ status: 200, data: { outcome: 'completed', workflowId: 'wf-1' } });
    expect(escalationService.flagBatchItem).toHaveBeenCalledWith('e-1', 'k', {
      label: 'Missing', actor: 'u-1', metadata: { resolved_by: 'u-1' }, resolvedBy: { id: 'u-1' },
    });
  });

  it('answers 404 for a row the caller cannot see and 403 for one they cannot act on', async () => {
    vi.mocked(assertReadAccess).mockResolvedValueOnce({ status: 403 } as any);
    expect((await flagBatchItem({ id: 'e-1', itemKey: 'k', label: 'Missing' }, auth)).status).toBe(404);
    vi.mocked(assertWriteAccess).mockResolvedValueOnce({ status: 403, error: 'no' } as any);
    expect((await flagBatchItem({ id: 'e-1', itemKey: 'k', label: 'Missing' }, auth)).status).toBe(403);
    expect(escalationService.flagBatchItem).not.toHaveBeenCalled();
  });

  it('rejects a missing key or label and a non-object payload', async () => {
    expect((await flagBatchItem({ id: 'e-1', itemKey: '', label: 'x' }, auth)).status).toBe(400);
    expect((await flagBatchItem({ id: 'e-1', itemKey: 'k', label: '' }, auth)).status).toBe(400);
    expect((await flagBatchItem({ id: 'e-1', itemKey: 'k', label: 'x', payload: [] as any }, auth)).status).toBe(400);
  });

  it.each([
    ['already-filled', 409], ['unknown-item', 400], ['not-batch', 400], ['already-resolved', 409], ['not-found', 404],
  ])('maps %s to %i', async (outcome, status) => {
    vi.mocked(escalationService.flagBatchItem).mockResolvedValue({ outcome: outcome as any, escalation: null });
    expect((await flagBatchItem({ id: 'e-1', itemKey: 'k', label: 'x' }, auth)).status).toBe(status);
  });
});

describe('unflagBatchItem', () => {
  it('clears a flag and reports one that is not there', async () => {
    expect((await unflagBatchItem({ id: 'e-1', itemKey: 'k' }, auth)).status).toBe(200);
    vi.mocked(escalationService.unflagBatchItem).mockResolvedValue({ outcome: 'not-flagged', escalation: null });
    expect((await unflagBatchItem({ id: 'e-1', itemKey: 'k' }, auth))).toMatchObject({ status: 409, data: { outcome: 'not-flagged' } });
  });
});

describe('wakesOnFlag', () => {
  it('reads the opt-in from a string or object envelope', () => {
    expect(wakesOnFlag('{"batch_wake_on_flag":true}')).toBe(true);
    expect(wakesOnFlag({ batch_wake_on_flag: true })).toBe(true);
    expect(wakesOnFlag('{}')).toBe(false);
    expect(wakesOnFlag('not json')).toBe(false);
    expect(wakesOnFlag(null)).toBe(false);
  });
});
