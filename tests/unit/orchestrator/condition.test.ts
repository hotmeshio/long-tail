import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@hotmeshio/hotmesh', () => ({
  Durable: {
    workflow: {
      condition: vi.fn(),
      proxyActivities: vi.fn(),
    },
  },
}));

vi.mock('../../../services/interceptor/activities', () => ({
  ltResolveEscalation: vi.fn(),
}));

import { Durable } from '@hotmeshio/hotmesh';
import { conditionLT } from '../../../services/orchestrator/condition';

const mockCondition = vi.mocked(Durable.workflow.condition);
const mockProxyActivities = vi.mocked(Durable.workflow.proxyActivities);

const mockLtResolveEscalation = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockProxyActivities.mockReturnValue({ ltResolveEscalation: mockLtResolveEscalation } as any);
});

describe('conditionLT — legacy path (no queueConfig)', () => {
  it('returns clean payload when signal has no $escalation_id', async () => {
    mockCondition.mockResolvedValue({ approved: true } as any);

    const result = await conditionLT<{ approved: boolean }>('sig-abc');

    expect(result).toEqual({ approved: true });
    expect(mockLtResolveEscalation).not.toHaveBeenCalled();
  });

  it('strips $escalation_id and calls ltResolveEscalation when present', async () => {
    mockCondition.mockResolvedValue({ approved: true, $escalation_id: 'esc-123' } as any);
    mockLtResolveEscalation.mockResolvedValue(undefined);

    const result = await conditionLT<{ approved: boolean }>('sig-abc');

    expect(result).toEqual({ approved: true });
    expect(mockLtResolveEscalation).toHaveBeenCalledWith({
      escalationId: 'esc-123',
      resolverPayload: { approved: true },
    });
  });
});

describe('conditionLT — signal-queue path (with queueConfig)', () => {
  it('calls condition with queueConfig and returns payload directly', async () => {
    mockCondition.mockResolvedValue({ decision: 'approve' } as any);

    const queueConfig = { role: 'reviewer', type: 'approval', metadata: { orderId: 'ord-1' } };
    const result = await conditionLT<{ decision: string }>('sig-sq', queueConfig);

    expect(mockCondition).toHaveBeenCalledWith('sig-sq', queueConfig);
    expect(result).toEqual({ decision: 'approve' });
  });

  it('does NOT call proxyActivities or ltResolveEscalation in signal-queue path', async () => {
    mockCondition.mockResolvedValue({ decision: 'approve' } as any);

    await conditionLT('sig-sq', { role: 'reviewer' });

    expect(mockProxyActivities).not.toHaveBeenCalled();
    expect(mockLtResolveEscalation).not.toHaveBeenCalled();
  });
});
