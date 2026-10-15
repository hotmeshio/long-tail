import { describe, it, expect, vi, beforeEach } from 'vitest';

// A batch fill through the human-queue tool records who filled it: the
// person calling /mcp, else lt-system for an internal call.

const mocks = vi.hoisted(() => ({ resolveBatchItem: vi.fn() }));
vi.mock('../../../services/escalation', async (io) => ({
  ...(await io<typeof import('../../../services/escalation')>()),
  resolveBatchItem: mocks.resolveBatchItem,
}));
vi.mock('../../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => new Set<string>()),
  getEnforcedFormSchema: vi.fn(async () => null),
}));

import { createHumanQueueServer } from '../../../system/mcp-servers/human-queue';
import { systemAuth } from '../../../system/mcp-servers/caller-auth';

const PERSON = '11111111-1111-4111-8111-111111111111';

async function fill(extra?: unknown) {
  const server = await createHumanQueueServer({ fresh: true, name: 'batch-actor-test' } as any);
  const tool = (server as any)._registeredTools.resolve_batch_item;
  return tool.handler({ escalation_id: 'e-1', item_key: 'cut', payload: { ok: true } }, extra);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBatchItem.mockResolvedValue({ outcome: 'accepted', remaining: 2, escalation: { status: 'pending' } });
});

describe('resolve_batch_item actor', () => {
  it('records the /mcp caller as the actor', async () => {
    await fill({ authInfo: { userId: PERSON, role: 'member' } });
    expect(mocks.resolveBatchItem.mock.calls[0][6]).toBe(PERSON);
  });

  it('records lt-system for an internal call', async () => {
    await fill();
    expect(mocks.resolveBatchItem.mock.calls[0][6]).toBe((await systemAuth()).userId);
  });
});
