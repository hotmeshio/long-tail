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

  it('legacy path: $resolution is stripped from the stored payload and re-attached to the return', async () => {
    const mockResolve = vi.fn().mockResolvedValue(undefined);
    (Durable.workflow.proxyActivities as ReturnType<typeof vi.fn>).mockReturnValue({ ltResolveEscalation: mockResolve });

    const resolution = { escalationId: 'esc-123', resolvedBy: 'user-1', resolvedByEmail: 'u1@example.com' };
    mockCondition.mockResolvedValue({
      approved: true,
      $escalation_id: 'esc-123',
      $resolution: resolution,
    });
    const result = await conditionLT<{ approved: boolean; $resolution?: typeof resolution }>('sig-1');

    // the audit column stays clean — provenance never persists
    expect(mockResolve).toHaveBeenCalledWith({
      escalationId: 'esc-123',
      resolverPayload: { approved: true },
    });
    // ...but the caller receives it alongside the payload
    expect(result).toEqual({ approved: true, $resolution: resolution });
  });

  it('efficient path: $resolution passes through untouched (already resolved server-side)', async () => {
    const resolution = { escalationId: 'esc-9', resolvedBy: 'user-2' };
    mockCondition.mockResolvedValue({ approved: true, $resolution: resolution });
    const result = await conditionLT<{ approved: boolean; $resolution?: typeof resolution }>('sig-1');
    expect(result).toEqual({ approved: true, $resolution: resolution });
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

  // ── SLA timeout passthrough (hotmesh 0.25.1) ────────────────────────────────

  it('forwards the full config — including timeout — to Durable.workflow.condition verbatim', async () => {
    mockCondition.mockResolvedValue({ approved: true });
    // `timeout` typechecks here because conditionLT's param IS the SDK's
    // ConditionQueueConfig — the passthrough is structural, not a copy.
    const config = {
      role: 'reviewer',
      description: 'SLA-gated review',
      metadata: { orderId: 'ORD-1' },
      timeout: '24h',
    };
    await conditionLT<{ approved: boolean }>('sig-sla', config);
    expect(mockCondition).toHaveBeenCalledWith('sig-sla', config);
  });

  it('propagates false when the SLA timer wins an escalation-bearing wait', async () => {
    const mockResolve = vi.fn();
    (Durable.workflow.proxyActivities as ReturnType<typeof vi.fn>).mockReturnValue({ ltResolveEscalation: mockResolve });
    mockCondition.mockResolvedValue(false);
    const result = await conditionLT('sig-sla', { role: 'reviewer', timeout: '30m' });
    expect(result).toBe(false);
    // The engine already expired the row in its timeout path — the wrapper
    // must never issue its own resolve against an expired escalation.
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
