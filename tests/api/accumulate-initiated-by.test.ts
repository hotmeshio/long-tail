import { describe, it, expect, vi, beforeEach } from 'vitest';

// initiatedBy credits the person a trusted service acts for. It is recorded
// as the entry's actor; the principal stays resolved_by and still gates the write.
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
vi.mock('../../workers', () => ({ createClient: () => ({ workflow: { getHandle: vi.fn(), start: vi.fn() } }) }));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import {
  accumulateItem, accumulateItemByMetadata, accumulateItemBySignalKey, removeItem,
} from '../../api/escalations/accumulate';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockGetBySignalKey = vi.mocked(escalationService.getEscalationBySignalKey);
const mockAdd = vi.mocked(escalationService.accumulateItem);
const mockAddBySignalKey = vi.mocked(escalationService.accumulateItemBySignalKey);
const mockAddByMeta = vi.mocked(escalationService.accumulateItemByMetadata);
const mockRemove = vi.mocked(escalationService.removeAccumulatedItem);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUser = vi.mocked(userService.getUser);

const SERVICE = { userId: '99999999-9999-4999-8999-999999999999' };
const PERSON = '11111111-1111-4111-8111-111111111111';
const BIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const bin = (): any => ({
  id: BIN_ID, status: 'pending', role: 'bin', signal_key: 'sig-bin', workflow_id: 'wf-1',
  metadata: { accumulate_count: 0, accumulate_max: 3, accumulate_keys: [] },
  envelope: JSON.stringify({ accumulate_items: {} }),
});
const accepted = (): any => ({ outcome: 'accepted', count: 1, remaining: 2, escalation: bin() });

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobal.mockResolvedValue(true);
  mockGetUser.mockResolvedValue({ id: PERSON } as any);
  mockGet.mockResolvedValue(bin());
  mockGetBySignalKey.mockResolvedValue(bin());
  mockAdd.mockResolvedValue(accepted());
  mockAddBySignalKey.mockResolvedValue(accepted());
  mockAddByMeta.mockResolvedValue(accepted());
  mockRemove.mockResolvedValue({ outcome: 'removed', count: 0, escalation: bin() } as any);
});

describe('initiatedBy on the accumulate family', () => {
  it('without it, the caller is the actor', async () => {
    await accumulateItem({ id: BIN_ID, itemKey: 'bag-1' }, SERVICE);
    expect(mockAdd.mock.calls[0][1]).toMatchObject({ actor: SERVICE.userId, metadata: { resolved_by: SERVICE.userId } });
  });

  it('a global caller credits the initiator; the principal stays resolved_by', async () => {
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'bag-1', initiatedBy: PERSON }, SERVICE);
    expect(result.status).toBe(200);
    expect(mockAdd.mock.calls[0][1]).toMatchObject({ actor: PERSON, metadata: { resolved_by: SERVICE.userId } });
  });

  it('by signal key and by metadata carry the initiator', async () => {
    await accumulateItemBySignalKey({ signalKey: 'sig-bin', itemKey: 'bag-1', initiatedBy: PERSON }, SERVICE);
    await accumulateItemByMetadata({ key: 'binKey', value: 'b-1', itemKey: 'bag-1', initiatedBy: PERSON }, SERVICE);
    expect(mockAddBySignalKey.mock.calls[0][1].actor).toBe(PERSON);
    expect(mockAddByMeta.mock.calls[0][2].actor).toBe(PERSON);
  });

  it('a removal carries the initiator', async () => {
    await removeItem({ id: BIN_ID, itemKey: 'bag-1', initiatedBy: PERSON }, SERVICE);
    expect(mockRemove.mock.calls[0][1]).toMatchObject({ actor: PERSON });
  });

  it('a caller without global access is refused before any write', async () => {
    mockHasGlobal.mockResolvedValue(false);
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'bag-1', initiatedBy: PERSON }, SERVICE);
    expect(result).toEqual({ status: 403, error: 'initiatedBy requires global escalation access' });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('naming yourself needs no global access', async () => {
    mockHasGlobal.mockResolvedValue(false);
    const result = await accumulateItemBySignalKey({ signalKey: 'sig-bin', itemKey: 'bag-1', initiatedBy: SERVICE.userId }, SERVICE);
    expect(result.error).not.toBe('initiatedBy requires global escalation access');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('a malformed or unknown initiator is refused', async () => {
    expect(await accumulateItem({ id: BIN_ID, itemKey: 'bag-1', initiatedBy: 'mae' }, SERVICE))
      .toEqual({ status: 400, error: 'initiatedBy must be a user id' });
    mockGetUser.mockResolvedValue(null);
    expect(await accumulateItem({ id: BIN_ID, itemKey: 'bag-1', initiatedBy: PERSON }, SERVICE))
      .toEqual({ status: 400, error: 'initiatedBy names no user' });
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
