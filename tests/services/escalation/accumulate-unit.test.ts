import { describe, it, expect, vi, beforeEach } from 'vitest';

// Delegation + event contract for the accumulate service layer, fully mocked:
// one SDK call per add or removal; `accepted` publishes escalation.updated
// with the count, `completed` publishes escalation.resolved, the reciprocal
// row publishes its own event, and failures publish nothing.
const mockClient = {
  accumulateItem: vi.fn(),
  accumulateItemByMetadata: vi.fn(),
  removeAccumulatedItem: vi.fn(),
  removeAccumulatedItemByMetadata: vi.fn(),
};
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(async () => mockClient),
}));
vi.mock('../../../services/escalation/crud', () => ({
  publishEscalationChange: vi.fn(),
}));

import {
  accumulateItem,
  accumulateItemBySignalKey,
  accumulateItemByMetadata,
  removeAccumulatedItem,
  removeAccumulatedItemByMetadata,
} from '../../../services/escalation/accumulate';
import { publishEscalationChange } from '../../../services/escalation/crud';

const ESC_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const mockPublish = vi.mocked(publishEscalationChange);

function makeEntry(overrides: Record<string, any> = {}): any {
  return {
    id: ESC_ID,
    status: 'pending',
    role: 'bin',
    type: 'rollup',
    subtype: '',
    priority: 2,
    signal_key: 'sig-1',
    workflow_id: 'wf-1',
    workflow_type: 'rollupBin',
    task_queue: 'q-1',
    assigned_to: null,
    assigned_until: null,
    metadata: { accumulate_count: 1, accumulate_max: 3, accumulate_keys: ['bag-1'] },
    envelope: { accumulate_items: { 'bag-1': { at: '2026-01-01T00:00:00Z' } } },
    milestones: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('accumulateItem (service)', () => {
  it('delegates verbatim to the SDK client and publishes progress on accepted', async () => {
    mockClient.accumulateItem.mockResolvedValue({ ok: true, outcome: 'accepted', count: 1, remaining: 2, entry: makeEntry() });
    const result = await accumulateItem(ESC_ID, { itemKey: 'bag-1', payload: { w: 1 }, actor: 'u-1', metadata: { a: 1 } });
    expect(mockClient.accumulateItem).toHaveBeenCalledTimes(1);
    expect(mockClient.accumulateItem).toHaveBeenCalledWith({
      id: ESC_ID, itemKey: 'bag-1', payload: { w: 1 }, actor: 'u-1', metadata: { a: 1 },
    });
    expect(result.outcome).toBe('accepted');
    expect(result.count).toBe(1);
    expect(result.remaining).toBe(2);
    expect(result.escalation?.id).toBe(ESC_ID);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const event = mockPublish.mock.calls[0][0] as any;
    expect(event.type).toBe('escalation.updated');
    expect(event.status).toBe('pending');
    expect(event.data.item_key).toBe('bag-1');
    expect(event.data.count).toBe(1);
    expect(event.data.actor).toBe('u-1');
    expect(event.data.reciprocal_id).toBeNull();
  });

  it('publishes escalation.resolved on completed', async () => {
    mockClient.accumulateItem.mockResolvedValue({
      ok: true, outcome: 'completed', count: 3, remaining: 0, entry: makeEntry({ status: 'resolved' }),
    });
    const result = await accumulateItem(ESC_ID, { itemKey: 'bag-3' });
    expect(result.outcome).toBe('completed');
    const event = mockPublish.mock.calls[0][0] as any;
    expect(event.type).toBe('escalation.resolved');
    expect(event.status).toBe('resolved');
  });

  it('publishes one event per side on a reciprocal add', async () => {
    mockClient.accumulateItem.mockResolvedValue({
      ok: true, outcome: 'accepted', count: 1, remaining: 2, entry: makeEntry(),
      reciprocal: { outcome: 'completed', count: 1, remaining: 0, entry: makeEntry({ id: MEMBER_ID, status: 'resolved', role: 'member' }) },
    });
    const result = await accumulateItem(ESC_ID, { itemKey: 'order-1', reciprocal: { id: MEMBER_ID } });
    expect(result.reciprocal?.outcome).toBe('completed');
    expect(result.reciprocal?.escalation.id).toBe(MEMBER_ID);
    expect(mockPublish).toHaveBeenCalledTimes(2);
    const [container, member] = mockPublish.mock.calls.map((c) => c[0] as any);
    expect(container.type).toBe('escalation.updated');
    expect(container.data.reciprocal_id).toBe(MEMBER_ID);
    expect(member.type).toBe('escalation.resolved');
    expect(member.escalationId).toBe(MEMBER_ID);
    expect(member.data.item_key).toBe(ESC_ID);
  });

  it('publishes nothing on a failure outcome', async () => {
    mockClient.accumulateItem.mockResolvedValue({ ok: false, outcome: 'duplicate-item' });
    const result = await accumulateItem(ESC_ID, { itemKey: 'bag-1' });
    expect(result).toEqual({ outcome: 'duplicate-item', count: -1, remaining: null, escalation: null });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID id and a non-UUID reciprocal id before any store call', async () => {
    expect((await accumulateItem('not-a-uuid', { itemKey: 'x' })).outcome).toBe('not-found');
    expect((await accumulateItem(ESC_ID, { itemKey: 'x', reciprocal: { id: 'nope' } })).outcome).toBe('reciprocal-not-found');
    expect(mockClient.accumulateItem).not.toHaveBeenCalled();
  });
});

describe('accumulateItemBySignalKey / ByMetadata (service)', () => {
  it('selects by signal key', async () => {
    mockClient.accumulateItem.mockResolvedValue({ ok: true, outcome: 'accepted', count: 1, remaining: null, entry: makeEntry() });
    await accumulateItemBySignalKey('sig-1', { itemKey: 'bag-1' });
    expect(mockClient.accumulateItem).toHaveBeenCalledWith({ signalKey: 'sig-1', itemKey: 'bag-1' });
  });

  it('selects by facet with roles', async () => {
    mockClient.accumulateItemByMetadata.mockResolvedValue({ ok: true, outcome: 'accepted', count: 1, remaining: null, entry: makeEntry() });
    await accumulateItemByMetadata('binKey', 'b-1', { itemKey: 'bag-1', roles: ['bin'] });
    expect(mockClient.accumulateItemByMetadata).toHaveBeenCalledWith({ key: 'binKey', value: 'b-1', itemKey: 'bag-1', roles: ['bin'] });
  });
});

describe('removeAccumulatedItem (service)', () => {
  it('publishes escalation.updated with removed: true on both rows, never resolved', async () => {
    mockClient.removeAccumulatedItem.mockResolvedValue({
      ok: true, outcome: 'removed', count: 0, entry: makeEntry({ metadata: { accumulate_count: 0 } }),
      reciprocal: { count: 0, entry: makeEntry({ id: MEMBER_ID, role: 'member' }) },
    });
    const result = await removeAccumulatedItem(ESC_ID, { itemKey: 'bag-1', actor: 'u-1', reciprocal: { id: MEMBER_ID } });
    expect(result.outcome).toBe('removed');
    expect(result.count).toBe(0);
    expect(result.reciprocal?.escalation.id).toBe(MEMBER_ID);
    expect(mockPublish).toHaveBeenCalledTimes(2);
    for (const call of mockPublish.mock.calls) {
      const event = call[0] as any;
      expect(event.type).toBe('escalation.updated');
      expect(event.data.removed).toBe(true);
      expect(event.data.actor).toBe('u-1');
    }
  });

  it('publishes nothing on item-absent and guards ids', async () => {
    mockClient.removeAccumulatedItem.mockResolvedValue({ ok: false, outcome: 'item-absent' });
    expect((await removeAccumulatedItem(ESC_ID, { itemKey: 'x' })).outcome).toBe('item-absent');
    expect(mockPublish).not.toHaveBeenCalled();
    expect((await removeAccumulatedItem('bad', { itemKey: 'x' })).outcome).toBe('not-found');
  });

  it('selects by facet', async () => {
    mockClient.removeAccumulatedItemByMetadata.mockResolvedValue({ ok: true, outcome: 'removed', count: 0, entry: makeEntry() });
    await removeAccumulatedItemByMetadata('binKey', 'b-1', { itemKey: 'bag-1' });
    expect(mockClient.removeAccumulatedItemByMetadata).toHaveBeenCalledWith({ key: 'binKey', value: 'b-1', itemKey: 'bag-1' });
  });
});
