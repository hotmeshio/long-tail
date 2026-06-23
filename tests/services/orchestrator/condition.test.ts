import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock HotMesh Durable — conditionLT wraps Durable.workflow.condition
vi.mock('@hotmeshio/hotmesh', () => ({
  Durable: {
    workflow: {
      condition: vi.fn(),
      proxyActivities: vi.fn().mockReturnValue({ ltResolveEscalation: vi.fn().mockResolvedValue(undefined) }),
    },
  },
}));

import { conditionLT } from '../../../services/orchestrator/condition';
import { Durable } from '@hotmeshio/hotmesh';

const mockCondition = Durable.workflow.condition as ReturnType<typeof vi.fn>;

describe('conditionLT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when condition returns null (escalation cancelled)', async () => {
    mockCondition.mockResolvedValue(null);
    const result = await conditionLT('sig-1');
    expect(result).toBeNull();
  });

  it('returns false when condition returns false (timeout)', async () => {
    mockCondition.mockResolvedValue(false);
    const result = await conditionLT('sig-1');
    expect(result).toBe(false);
  });

  it('returns payload directly when no $escalation_id present', async () => {
    mockCondition.mockResolvedValue({ approved: true });
    const result = await conditionLT<{ approved: boolean }>('sig-1');
    expect(result).toEqual({ approved: true });
  });

  it('strips $escalation_id and calls ltResolveEscalation for legacy path', async () => {
    const { proxyActivities } = Durable.workflow;
    const mockResolve = vi.fn().mockResolvedValue(undefined);
    (proxyActivities as ReturnType<typeof vi.fn>).mockReturnValue({ ltResolveEscalation: mockResolve });

    mockCondition.mockResolvedValue({ approved: true, $escalation_id: 'esc-123' });
    const result = await conditionLT<{ approved: boolean }>('sig-1');

    expect(result).toEqual({ approved: true });
    expect(mockResolve).toHaveBeenCalledWith({
      escalationId: 'esc-123',
      resolverPayload: { approved: true },
    });
  });

  it('does not call ltResolveEscalation when result is null', async () => {
    const mockResolve = vi.fn();
    (Durable.workflow.proxyActivities as ReturnType<typeof vi.fn>).mockReturnValue({ ltResolveEscalation: mockResolve });
    mockCondition.mockResolvedValue(null);
    await conditionLT('sig-1');
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('does not call ltResolveEscalation when result is false', async () => {
    const mockResolve = vi.fn();
    (Durable.workflow.proxyActivities as ReturnType<typeof vi.fn>).mockReturnValue({ ltResolveEscalation: mockResolve });
    mockCondition.mockResolvedValue(false);
    await conditionLT('sig-1');
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
