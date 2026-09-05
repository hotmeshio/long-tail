import { describe, it, expect, vi, beforeEach } from 'vitest';

// Open input reaching uuid columns must be shape-checked BEFORE SQL: a
// non-UUID is definitionally not-found, never a Postgres cast error. The
// client mock proves the guard short-circuits — zero store calls.
const mockClient = {
  get: vi.fn(),
  claim: vi.fn(),
  resolve: vi.fn(),
  cancel: vi.fn(),
  release: vi.fn(),
  escalateToRole: vi.fn(),
  list: vi.fn(async () => []),
  resolveMany: vi.fn(async () => []),
  resolveAllOrNone: vi.fn(),
  resolveBatchItem: vi.fn(),
  claimMany: vi.fn(async () => ({ claimed: 0, skipped: 0 })),
  updateManyPriority: vi.fn(async () => 0),
};
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(async () => mockClient),
  ensureEscalationCompatView: vi.fn(),
}));
vi.mock('../../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
vi.mock('../../../lib/db', () => ({ getPool: vi.fn(), getConnection: vi.fn() }));

import { isUuid, onlyUuids } from '../../../lib/uuid';
import * as crud from '../../../services/escalation/crud';
import { resolveBatchItem } from '../../../services/escalation/batch';

const GARBAGE = 'Sample1 Jill Prinsen';
const REAL = '3f216994-7704-4e7a-9702-62130afaf9b0';

beforeEach(() => vi.clearAllMocks());

describe('lib/uuid', () => {
  it('accepts UUIDs of any case, rejects everything else', () => {
    expect(isUuid(REAL)).toBe(true);
    expect(isUuid(REAL.toUpperCase())).toBe(true);
    expect(isUuid(GARBAGE)).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(`${REAL} `)).toBe(false);
  });

  it('onlyUuids drops the malformed members', () => {
    expect(onlyUuids([REAL, GARBAGE, ''])).toEqual([REAL]);
  });
});

describe('single-id service guards — null without a store call', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['getEscalation', () => crud.getEscalation(GARBAGE)],
    ['claimEscalation', () => crud.claimEscalation(GARBAGE, 'u1')],
    ['resolveEscalation', () => crud.resolveEscalation(GARBAGE, { ok: true })],
    ['cancelEscalation', () => crud.cancelEscalation(GARBAGE)],
    ['releaseEscalation', () => crud.releaseEscalation(GARBAGE, 'u1')],
    ['escalateToRole', () => crud.escalateToRole(GARBAGE, 'target')],
  ];
  for (const [name, call] of cases) {
    it(name, async () => {
      expect(await call()).toBeNull();
      for (const fn of Object.values(mockClient)) expect(fn).not.toHaveBeenCalled();
    });
  }

  it('resolveBatchItem reports not-found', async () => {
    const result = await resolveBatchItem(GARBAGE, 'cut', { ok: true });
    expect(result).toEqual({ outcome: 'not-found', remaining: -1, escalation: null });
    expect(mockClient.resolveBatchItem).not.toHaveBeenCalled();
  });
});

describe('array service guards — malformed members can match nothing', () => {
  it('getEscalationsByIds filters before the query', async () => {
    await crud.getEscalationsByIds([GARBAGE, REAL]);
    expect(mockClient.list).toHaveBeenCalledWith(expect.objectContaining({ ids: [REAL] }));
  });

  it('an all-garbage list never reaches the store', async () => {
    expect(await crud.getEscalationsByIds([GARBAGE])).toEqual([]);
    expect(mockClient.list).not.toHaveBeenCalled();
  });

  it('resolveEscalationsAllOrNone blocks the batch on a malformed member', async () => {
    const result = await crud.resolveEscalationsAllOrNone([
      { id: REAL, resolverPayload: {} },
      { id: GARBAGE, resolverPayload: {} },
    ]);
    expect(result).toEqual({ ok: false, failed: [{ id: GARBAGE, reason: 'not-found' }] });
    expect(mockClient.resolveAllOrNone).not.toHaveBeenCalled();
  });
});
