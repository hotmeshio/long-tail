import { describe, it, expect, vi, beforeEach } from 'vitest';

// The row type's item check runs inside the accumulate gate, on every path.
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => new Set<string>()),
  getEnforcedFormSchema: vi.fn(async () => null),
}));
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { accumulateItem, accumulateItemBySignalKey } from '../../api/escalations/accumulate';

const AUTH = { userId: 'user-uuid' };
const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST = {
  id: ID, type: 'machine-request', status: 'pending', role: 'loader', signal_key: 'machine-request:s:l:m:r',
  metadata: { siteId: 's', lineId: 'l', machineId: 'm', op: 'material-ack', ref: 'r' },
  envelope: JSON.stringify({ accumulate_items: {}, accumulate_config: {} }),
} as any;
const check = vi.mocked(escalationService.checkItem);
const add = vi.mocked(escalationService.accumulateItem);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.hasGlobalEscalationAccess).mockResolvedValue(true);
  vi.mocked(escalationService.getEscalation).mockResolvedValue(REQUEST);
  vi.mocked(escalationService.getEscalationBySignalKey).mockResolvedValue(REQUEST);
  check.mockResolvedValue(null);
});

describe('accumulate: the row type item check', () => {
  it('a refused item answers 422 with the reason and nothing is added', async () => {
    check.mockResolvedValue('the line\'s codec has no material-ack command for these args');
    const result = await accumulateItem({ id: ID, itemKey: 'answer', payload: { args: { accepted: 'maybe' } } }, AUTH);
    expect(result).toMatchObject({ status: 422, error: expect.stringMatching(/no material-ack command/) });
    expect(check).toHaveBeenCalledWith(REQUEST, 'answer', { args: { accepted: 'maybe' } });
    expect(add).not.toHaveBeenCalled();
  });

  it('an item with no payload is still checked', async () => {
    check.mockResolvedValue('an answer needs args');
    expect((await accumulateItem({ id: ID, itemKey: 'answer' }, AUTH)).status).toBe(422);
    expect(check).toHaveBeenCalledWith(REQUEST, 'answer', undefined);
  });

  it('an accepted item is added', async () => {
    add.mockResolvedValue({ outcome: 'accepted', count: 1, remaining: null, escalation: REQUEST } as any);
    const result = await accumulateItem({ id: ID, itemKey: 'answer', payload: { args: { accepted: true } } }, AUTH);
    expect(result.status).toBe(200);
    expect(add).toHaveBeenCalled();
  });

  it('the by-signal-key path checks too', async () => {
    check.mockResolvedValue('refused');
    const result = await accumulateItemBySignalKey({ signalKey: REQUEST.signal_key, itemKey: 'answer', payload: { args: {} } }, AUTH);
    expect(result.status).toBe(422);
    expect(add).not.toHaveBeenCalled();
  });
});
