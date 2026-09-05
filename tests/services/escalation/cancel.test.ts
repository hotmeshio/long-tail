import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the escalation client and publishEscalationEvent
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(),
  ensureEscalationCompatView: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import { cancelEscalation } from '../../../services/escalation/crud';
import { escalations } from '../../../services/escalation/client';

// Guarded surfaces reject non-UUID ids before any store call — fixtures must be real UUIDs.
const ESC_ID = '11111111-1111-4111-8111-111111111111';

const mockEscalations = escalations as ReturnType<typeof vi.fn>;

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ESC_ID,
    namespace: 'hmsh',
    app_id: 'hmsh',
    type: 'approval',
    subtype: 'review',
    status: 'pending',
    role: 'reviewer',
    priority: 2,
    workflow_id: 'wf-1',
    workflow_type: 'basicSignal',
    task_queue: 'long-tail-examples',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('cancelEscalation', () => {
  const mockCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockEscalations.mockResolvedValue({ cancel: mockCancel });
  });

  it('returns null when SDK reports already-terminal', async () => {
    mockCancel.mockResolvedValue({ ok: false, reason: 'already-terminal' });
    const result = await cancelEscalation(ESC_ID);
    expect(result).toBeNull();
  });

  it('returns null when SDK reports not-found', async () => {
    mockCancel.mockResolvedValue({ ok: false, reason: 'not-found' });
    const result = await cancelEscalation(ESC_ID);
    expect(result).toBeNull();
  });

  it('returns the cancelled record on success', async () => {
    const entry = makeEntry({ status: 'cancelled' });
    mockCancel.mockResolvedValue({ ok: true, entry });
    const result = await cancelEscalation(ESC_ID);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ESC_ID);
  });

  it('calls SDK cancel with the provided id', async () => {
    const entry = makeEntry({ status: 'cancelled' });
    mockCancel.mockResolvedValue({ ok: true, entry });
    const otherId = '22222222-2222-4222-8222-222222222222';
    await cancelEscalation(otherId);
    expect(mockCancel).toHaveBeenCalledWith(otherId);
  });

  it('publishes escalation.cancelled event on success', async () => {
    const { publishEscalationEvent } = await import('../../../lib/events/publish');
    const entry = makeEntry({ status: 'cancelled', workflow_id: 'wf-test', workflow_type: 'basicSignal', task_queue: 'q1' });
    mockCancel.mockResolvedValue({ ok: true, entry });
    await cancelEscalation(ESC_ID);
    expect(publishEscalationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'escalation.cancelled', status: 'cancelled' }),
    );
  });
});
