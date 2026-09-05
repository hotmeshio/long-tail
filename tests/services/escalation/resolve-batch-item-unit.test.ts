import { describe, it, expect, vi, beforeEach } from 'vitest';

// Delegation + event contract for the batch service layer, fully mocked:
// one SDK call per fill; `accepted` publishes escalation.updated with
// progress, `completed` publishes escalation.resolved, failures publish nothing.
const mockClient = {
  resolveBatchItem: vi.fn(),
  resolveBatchItemByMetadata: vi.fn(),
};
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(async () => mockClient),
}));
vi.mock('../../../services/escalation/crud', () => ({
  publishEscalationChange: vi.fn(),
}));

import {
  resolveBatchItem,
  resolveBatchItemBySignalKey,
  resolveBatchItemByMetadata,
} from '../../../services/escalation/batch';
import { publishEscalationChange } from '../../../services/escalation/crud';

// Guarded surfaces reject non-UUID ids before any store call — fixtures must be real UUIDs.
const ESC_ID = '11111111-1111-4111-8111-111111111111';

const mockPublish = vi.mocked(publishEscalationChange);

function makeEntry(overrides: Record<string, any> = {}): any {
  return {
    id: ESC_ID,
    status: 'pending',
    role: 'assembly',
    type: 'batch-order',
    subtype: '',
    priority: 2,
    signal_key: 'sig-1',
    workflow_id: 'wf-1',
    workflow_type: 'batchSignal',
    task_queue: 'q-1',
    assigned_to: null,
    assigned_until: null,
    metadata: { batch_count: 1, batch_pending: ['weld'] },
    envelope: { batch_items: { cut: { ok: true } } },
    milestones: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveBatchItem (service)', () => {
  it('delegates the fill verbatim to the SDK client — one call, no find-then-update', async () => {
    mockClient.resolveBatchItem.mockResolvedValue({
      ok: true, outcome: 'accepted', remaining: 1, entry: makeEntry(),
    });
    await resolveBatchItem(ESC_ID, 'cut', { ok: true }, { station: 's1' }, 'me', { id: 'me' });
    expect(mockClient.resolveBatchItem).toHaveBeenCalledOnce();
    expect(mockClient.resolveBatchItem).toHaveBeenCalledWith({
      id: ESC_ID,
      itemKey: 'cut',
      payload: { ok: true },
      metadata: { station: 's1' },
      assertClaim: 'me',
      resolvedBy: { id: 'me' },
    });
  });

  it('publishes escalation.updated with progress on an interim fill', async () => {
    mockClient.resolveBatchItem.mockResolvedValue({
      ok: true, outcome: 'accepted', remaining: 1, entry: makeEntry(),
    });
    const result = await resolveBatchItem(ESC_ID, 'cut', { ok: true });
    expect(result.outcome).toBe('accepted');
    expect(result.remaining).toBe(1);
    expect(result.escalation?.id).toBe(ESC_ID);
    expect(mockPublish).toHaveBeenCalledOnce();
    const event = mockPublish.mock.calls[0][0];
    expect(event.type).toBe('escalation.updated');
    expect(event.status).toBe('pending');
    expect((event.data as any).item_key).toBe('cut');
    expect((event.data as any).remaining).toBe(1);
  });

  it('publishes escalation.resolved on the completing fill', async () => {
    mockClient.resolveBatchItem.mockResolvedValue({
      ok: true, outcome: 'completed', remaining: 0, entry: makeEntry({ status: 'resolved' }),
    });
    const result = await resolveBatchItem(ESC_ID, 'weld', { ok: true });
    expect(result.outcome).toBe('completed');
    const event = mockPublish.mock.calls[0][0];
    expect(event.type).toBe('escalation.resolved');
    expect(event.status).toBe('resolved');
  });

  it('publishes nothing on a failure outcome — the row was untouched', async () => {
    mockClient.resolveBatchItem.mockResolvedValue({ ok: false, outcome: 'duplicate-item' });
    const result = await resolveBatchItem(ESC_ID, 'cut', { ok: true });
    expect(result.outcome).toBe('duplicate-item');
    expect(result.escalation).toBeNull();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe('resolveBatchItemBySignalKey (service)', () => {
  it('delegates the signal-key selector verbatim (claim-agnostic surface)', async () => {
    mockClient.resolveBatchItem.mockResolvedValue({
      ok: true, outcome: 'accepted', remaining: 1, entry: makeEntry(),
    });
    await resolveBatchItemBySignalKey('sig-1', 'cut', { ok: true }, { unit: 'u1-L' }, { id: 'me' });
    expect(mockClient.resolveBatchItem).toHaveBeenCalledWith({
      signalKey: 'sig-1',
      itemKey: 'cut',
      payload: { ok: true },
      metadata: { unit: 'u1-L' },
      resolvedBy: { id: 'me' },
    });
    expect(mockPublish.mock.calls[0][0].type).toBe('escalation.updated');
  });
});

describe('resolveBatchItemByMetadata (service)', () => {
  it('delegates the facet selector verbatim', async () => {
    mockClient.resolveBatchItemByMetadata.mockResolvedValue({
      ok: true, outcome: 'accepted', remaining: 1, entry: makeEntry(),
    });
    await resolveBatchItemByMetadata(
      'orderId', 'ORD-1', 'cut', { ok: true }, ['assembly'], { outcome: 'x' }, { id: 'me' },
    );
    expect(mockClient.resolveBatchItemByMetadata).toHaveBeenCalledWith({
      key: 'orderId',
      value: 'ORD-1',
      roles: ['assembly'],
      itemKey: 'cut',
      payload: { ok: true },
      metadata: { outcome: 'x' },
      resolvedBy: { id: 'me' },
    });
  });

  it('shares the event contract with the by-id form', async () => {
    mockClient.resolveBatchItemByMetadata.mockResolvedValue({
      ok: true, outcome: 'completed', remaining: 0, entry: makeEntry({ status: 'resolved' }),
    });
    await resolveBatchItemByMetadata('orderId', 'ORD-1', 'weld', { ok: true });
    expect(mockPublish.mock.calls[0][0].type).toBe('escalation.resolved');
  });
});
