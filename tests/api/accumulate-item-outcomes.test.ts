import { describe, it, expect, vi, beforeEach } from 'vitest';

// Failure bodies name the store's outcome, so a caller tells a duplicate from
// a container boundary without reading message text. Item keys longer than
// the store accepts are a 400, never a 500.
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => new Set<string>()),
  getEnforcedFormSchema: vi.fn(async () => null),
}));
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
vi.mock('../../workers', () => ({
  createClient: () => ({ workflow: { getHandle: vi.fn(), start: vi.fn() } }),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { accumulateItem } from '../../api/escalations/accumulate';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockAdd = vi.mocked(escalationService.accumulateItem);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);

const AUTH = { userId: 'user-uuid' };
const BIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeBin(overrides: Record<string, any> = {}): any {
  return {
    id: BIN_ID,
    status: 'pending',
    role: 'bin',
    signal_key: 'sig-bin-1',
    assigned_to: null,
    assigned_until: null,
    workflow_id: 'wf-1',
    workflow_type: 'rollupBin',
    task_queue: 'long-tail-examples',
    metadata: { accumulate_count: 1, accumulate_max: 3, accumulate_keys: ['bag-1'] },
    envelope: JSON.stringify({
      accumulate_items: { 'bag-1': { at: '2026-01-01T00:00:01Z', payload: { w: 1 } } },
      accumulate_config: { unique: true, resolveAtMax: true },
    }),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const accepted = (count: number, remaining: number | null): any => ({
  outcome: 'accepted', count, remaining, escalation: makeBin(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobal.mockResolvedValue(true);
});

describe('accumulateItem (api) — failure bodies carry the outcome', () => {
  it('a duplicate names itself, alongside the item key', async () => {
    mockGet.mockResolvedValue(makeBin());
    mockAdd.mockResolvedValue({ outcome: 'duplicate-item' } as any);
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'bag-1' }, AUTH);
    expect(result).toMatchObject({ status: 409, error: 'Item already held', data: { outcome: 'duplicate-item', itemKey: 'bag-1' } });
  });

  it('full, claim, and terminal outcomes name themselves', async () => {
    mockGet.mockResolvedValue(makeBin());
    for (const outcome of ['full', 'claimed-by-other', 'claim-expired', 'already-resolved']) {
      mockAdd.mockResolvedValue({ outcome } as any);
      const result = await accumulateItem({ id: BIN_ID, itemKey: 'x' }, AUTH);
      expect(result.status).toBe(409);
      expect((result.data as any).outcome).toBe(outcome);
    }
  });

  it('a row already terminal before the write names its status', async () => {
    for (const [status, outcome] of [['cancelled', 'already-cancelled'], ['resolved', 'already-resolved'], ['expired', 'already-expired']]) {
      mockGet.mockResolvedValue(makeBin({ status }));
      expect((await accumulateItem({ id: BIN_ID, itemKey: 'x' }, AUTH)).data).toMatchObject({ outcome });
    }
  });

  it('success bodies are unchanged', async () => {
    mockGet.mockResolvedValue(makeBin());
    mockAdd.mockResolvedValue(accepted(2, 1));
    expect((await accumulateItem({ id: BIN_ID, itemKey: 'bag-2' }, AUTH)).data).toEqual({
      outcome: 'accepted', count: 2, remaining: 1, escalationId: BIN_ID,
    });
  });
});

describe('accumulateItem (api) — item key length', () => {
  it('a key longer than the store accepts is a 400 before any read', async () => {
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'k'.repeat(129) }, AUTH);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/at most 128/);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('a 128-character key is accepted', async () => {
    mockGet.mockResolvedValue(makeBin());
    mockAdd.mockResolvedValue(accepted(2, 1));
    expect((await accumulateItem({ id: BIN_ID, itemKey: 'k'.repeat(128) }, AUTH)).status).toBe(200);
  });
});
