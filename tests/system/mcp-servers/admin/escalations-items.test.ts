import { describe, it, expect, vi, beforeEach } from 'vitest';

// The admin item tools forward initiatedBy so a recovery add credits the person.
const mockAccumulate = vi.fn();
const mockRemove = vi.fn();
vi.mock('../../../../services/iam', () => ({ ensureSystemBot: vi.fn().mockResolvedValue('system-uuid') }));
vi.mock('../../../../api/escalations', () => ({
  accumulateItem: (...a: unknown[]) => mockAccumulate(...a),
  removeItem: (...a: unknown[]) => mockRemove(...a),
}));
vi.mock('../../../../api/escalations/metadata', () => ({
  findByMetadata: vi.fn(), claimByMetadata: vi.fn(), resolveByMetadata: vi.fn(),
}));
vi.mock('../../../../api/escalations/bulk', () => ({
  bulkClaim: vi.fn(), bulkAssign: vi.fn(), bulkEscalate: vi.fn(), updatePriority: vi.fn(),
}));
vi.mock('../../../../services/escalation', () => ({
  getEscalationStats: vi.fn(), releaseExpiredClaims: vi.fn(), bulkResolveForTriage: vi.fn(),
}));

import { registerEscalationTools } from '../../../../system/mcp-servers/admin/escalations';

const PERSON = '22222222-2222-4222-8222-222222222222';
let tools: Map<string, (args: any) => Promise<any>>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = new Map();
  registerEscalationTools({ registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any);
  mockAccumulate.mockResolvedValue({ status: 200, data: { outcome: 'accepted' } });
  mockRemove.mockResolvedValue({ status: 200, data: { outcome: 'removed' } });
});

describe('admin accumulate_item and remove_item', () => {
  it('accumulate_item forwards initiatedBy as the system caller', async () => {
    await tools.get('accumulate_item')!({ id: 'box-1', itemKey: 'bag-1', initiatedBy: PERSON });
    expect(mockAccumulate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'box-1', itemKey: 'bag-1', initiatedBy: PERSON }),
      expect.objectContaining({ userId: 'system-uuid' }),
    );
  });

  it('remove_item forwards initiatedBy', async () => {
    await tools.get('remove_item')!({ id: 'box-1', itemKey: 'bag-1', initiatedBy: PERSON });
    expect(mockRemove.mock.calls[0][0]).toMatchObject({ itemKey: 'bag-1', initiatedBy: PERSON });
  });

  it('without initiatedBy the system caller stays the actor', async () => {
    await tools.get('accumulate_item')!({ id: 'box-1', itemKey: 'bag-1' });
    expect(mockAccumulate.mock.calls[0][0].initiatedBy).toBeUndefined();
  });

  it('a refused initiator surfaces as isError', async () => {
    mockAccumulate.mockResolvedValue({ status: 400, error: 'initiatedBy names no user' });
    const result = await tools.get('accumulate_item')!({ id: 'box-1', itemKey: 'bag-1', initiatedBy: PERSON });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('initiatedBy names no user');
  });
});
