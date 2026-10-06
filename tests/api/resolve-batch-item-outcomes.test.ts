import { describe, it, expect, vi, beforeEach } from 'vitest';

// Batch fill failures name the store's outcome, so a scan fill tells a slot
// another bench just filled (duplicate) from a closed batch.
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../services/task');
vi.mock('../../services/escalation-strategy', () => ({ escalationStrategyRegistry: { current: null } }));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
vi.mock('../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(async () => 'eph-uuid-1'),
  formatEphemeralToken: (uuid: string, label: string) => `eph:v1:${label}:${uuid}`,
}));
vi.mock('../../workers', () => ({ createClient: () => ({ workflow: { getHandle: vi.fn(), start: vi.fn() } }) }));
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => new Set<string>()),
  getEnforcedFormSchema: vi.fn(async () => null),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveBatchItem } from '../../api/escalations/resolve-batch';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockFill = vi.mocked(escalationService.resolveBatchItem);
const AUTH = { userId: 'user-uuid' };
const batch = (over: Record<string, unknown> = {}): any => ({
  id: 'esc-batch', status: 'pending', role: 'matching', assigned_to: null, workflow_id: 'wf-1',
  metadata: { batch_pending: ['a#1', 'a#2'], batch_count: 2, batch_keys: ['a#1', 'a#2'] },
  envelope: JSON.stringify({ batch_items: {} }),
  ...over,
});
const fill = (itemKey = 'a#1') => resolveBatchItem({ id: 'esc-batch', itemKey, resolverPayload: { upc: 'a' } }, AUTH);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.hasGlobalEscalationAccess).mockResolvedValue(true);
});

describe('resolveBatchItem (api) — failure bodies carry the outcome', () => {
  it('a slot already filled names duplicate-item and the key', async () => {
    mockGet.mockResolvedValue(batch());
    mockFill.mockResolvedValue({ outcome: 'duplicate-item' } as any);
    expect(await fill()).toMatchObject({ status: 409, data: { outcome: 'duplicate-item', itemKey: 'a#1' } });
  });

  it('an undeclared key names unknown-item; statuses are unchanged', async () => {
    mockGet.mockResolvedValue(batch());
    mockFill.mockResolvedValue({ outcome: 'unknown-item' } as any);
    expect(await fill('z')).toMatchObject({ status: 400, data: { outcome: 'unknown-item' } });
  });

  it('a batch already closed names its status, before or at the write', async () => {
    mockGet.mockResolvedValue(batch({ status: 'resolved' }));
    expect(await fill()).toMatchObject({ status: 409, data: { outcome: 'already-resolved' } });
    mockGet.mockResolvedValue(batch());
    mockFill.mockResolvedValue({ outcome: 'already-expired' } as any);
    expect(await fill()).toMatchObject({ status: 409, data: { outcome: 'already-expired' } });
  });
});
