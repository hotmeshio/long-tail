import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(),
  ensureEscalationCompatView: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import { releaseEscalation } from '../../../services/escalation/crud';
import { escalations } from '../../../services/escalation/client';
import { publishEscalationEvent } from '../../../lib/events/publish';

const mockEscalations = escalations as ReturnType<typeof vi.fn>;
const mockPublish = vi.mocked(publishEscalationEvent);

// A quiet release is byte-identical to a loud one — same DB write, same
// return shape — except the `released` event is never produced. Bookkeeping
// releases (a dispatcher's held-skip loop) use it; the default stays loud.

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'esc-1',
    type: 'printer',
    subtype: 'printing',
    status: 'pending',
    role: 'printer-fleet',
    priority: 2,
    workflow_id: 'wf-1',
    workflow_type: 'orderPipeline',
    task_queue: 'farm',
    assigned_to: null,
    claimed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('releaseEscalation — quiet option', () => {
  const mockRelease = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockEscalations.mockResolvedValue({ release: mockRelease });
    mockRelease.mockResolvedValue({ ok: true, entry: makeEntry() });
  });

  it('default release publishes the released event', async () => {
    const result = await releaseEscalation('esc-1', 'broker-1');
    expect(result?.id).toBe('esc-1');
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'escalation.released', escalationId: 'esc-1' }),
    );
  });

  it('quiet release performs the identical release with no event', async () => {
    const result = await releaseEscalation('esc-1', 'broker-1', { quiet: true });
    expect(mockRelease).toHaveBeenCalledWith({ id: 'esc-1', assignee: 'broker-1' });
    expect(result?.id).toBe('esc-1');
    expect(result?.assigned_to).toBeNull();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('an explicit quiet: false stays loud', async () => {
    await releaseEscalation('esc-1', 'broker-1', { quiet: false });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('a failed release returns null and never publishes, quiet or loud', async () => {
    mockRelease.mockResolvedValue({ ok: false });
    expect(await releaseEscalation('esc-1', 'broker-1')).toBeNull();
    expect(await releaseEscalation('esc-1', 'broker-1', { quiet: true })).toBeNull();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
