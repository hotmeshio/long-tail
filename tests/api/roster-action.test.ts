import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation', () => ({ getEscalationWithFormSchema: vi.fn() }));
vi.mock('../../services/escalation/roster', () => ({ loadRoster: vi.fn() }));
vi.mock('../../services/user', () => ({ getUserRoles: vi.fn(), isSuperAdmin: vi.fn() }));
vi.mock('../../services/iam/acting-identity', () => ({
  peekActingAuth: vi.fn(), consumeActingGrant: vi.fn(), refundActingGrant: vi.fn(),
}));
vi.mock('../../api/escalations/helpers', () => ({ assertReadAccess: vi.fn() }));
vi.mock('../../api/escalations/resolve', () => ({ resolveEscalation: vi.fn() }));
vi.mock('../../api/escalations/resolve-batch', () => ({ resolveBatchItem: vi.fn() }));
vi.mock('../../api/escalations/batch-flag', () => ({ flagBatchItem: vi.fn(), unflagBatchItem: vi.fn() }));

import * as escalationService from '../../services/escalation';
import { loadRoster } from '../../services/escalation/roster';
import * as userService from '../../services/user';
import * as acting from '../../services/iam/acting-identity';
import { assertReadAccess } from '../../api/escalations/helpers';
import { resolveEscalation } from '../../api/escalations/resolve';
import { resolveBatchItem } from '../../api/escalations/resolve-batch';
import { flagBatchItem } from '../../api/escalations/batch-flag';
import { runRosterAction } from '../../api/escalations/roster-action';

const station = { userId: 'station-1' };
const ACTIONS = [
  { label: 'Missing', flag: { label: 'Missing', payload: { order: '{{metadata.orderId}}' } } },
  { label: 'Key in', fill: { payload: { source: 'key-in' }, enterCode: true }, roles: ['manager'], refuse: "A manager's badge is needed." },
];
const batchSchema = { properties: { shoes: { 'x-lt-roster': { expected: { batch: true } }, 'x-lt-actions': ACTIONS } } };
const host = { id: 'match-1', role: 'matching', metadata: { orderId: 'o-9' }, envelope: '{}' };
const entries = [{ key: '00812999000011#1', state: 'waiting' }];

const base = { id: 'match-1', field: 'shoes', action: 0, entry: '00812999000011#1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(escalationService.getEscalationWithFormSchema).mockResolvedValue({ escalation: host, form_schema: batchSchema } as any);
  vi.mocked(assertReadAccess).mockResolvedValue(null as any);
  vi.mocked(loadRoster).mockResolvedValue({ entries, counts: {} } as any);
  vi.mocked(userService.getUserRoles).mockResolvedValue([{ role: 'packer' }] as any);
  vi.mocked(userService.isSuperAdmin).mockResolvedValue(false);
  vi.mocked(flagBatchItem).mockResolvedValue({ status: 200, data: { outcome: 'flagged' } });
  vi.mocked(resolveBatchItem).mockResolvedValue({ status: 200, data: { outcome: 'completed' } });
});

describe('runRosterAction', () => {
  it('runs the declared act with the payload built on the server', async () => {
    const result = await runRosterAction(base, station);
    expect(result.status).toBe(200);
    expect(flagBatchItem).toHaveBeenCalledWith(
      { id: 'match-1', itemKey: '00812999000011#1', label: 'Missing', payload: { order: 'o-9' } }, station);
  });

  it('answers 404 for a row the station cannot read', async () => {
    vi.mocked(assertReadAccess).mockResolvedValue({ status: 403 } as any);
    expect((await runRosterAction(base, station)).status).toBe(404);
    expect(flagBatchItem).not.toHaveBeenCalled();
  });

  it('refuses an action or an entry the server does not find', async () => {
    expect((await runRosterAction({ ...base, action: 7 }, station)).status).toBe(409);
    expect((await runRosterAction({ ...base, entry: 'not-on-roster' }, station)).status).toBe(409);
    expect((await runRosterAction({ ...base, field: 'other' }, station)).status).toBe(409);
    expect(flagBatchItem).not.toHaveBeenCalled();
  });

  it('checks an entered code before reading or spending any badge', async () => {
    const result = await runRosterAction({ ...base, action: 1, code: '812999000028', actingToken: 'eph:t' }, station);
    expect(result).toMatchObject({ status: 422, data: { outcome: 'code_mismatch', error: 'That code is not 0812999000011.' } });
    expect(acting.peekActingAuth).not.toHaveBeenCalled();
    expect(acting.consumeActingGrant).not.toHaveBeenCalled();
  });

  it('asks for a badge when the person acting lacks the role', async () => {
    const result = await runRosterAction({ ...base, action: 1, code: '812999000011' }, station);
    expect(result).toMatchObject({ status: 403, data: { outcome: 'needs_badge', error: "A manager's badge is needed." } });
    expect(resolveBatchItem).not.toHaveBeenCalled();
  });

  it('refuses a badge without the role and leaves it unspent', async () => {
    vi.mocked(acting.peekActingAuth).mockResolvedValue({ ok: true, auth: { userId: 'u-packer' }, grant: {} } as any);
    const result = await runRosterAction({ ...base, action: 1, code: '812999000011', actingToken: 'eph:t' }, station);
    expect(result).toMatchObject({ status: 403, data: { outcome: 'role_refused' } });
    expect(userService.getUserRoles).toHaveBeenCalledWith('u-packer');
    expect(acting.consumeActingGrant).not.toHaveBeenCalled();
  });

  it('runs as the badged manager, spending the badge once', async () => {
    vi.mocked(acting.peekActingAuth).mockResolvedValue({ ok: true, auth: { userId: 'u-mgr' }, grant: {} } as any);
    vi.mocked(acting.consumeActingGrant).mockResolvedValue({ ok: true, auth: { userId: 'u-mgr' }, grant: { remaining: 0 } } as any);
    vi.mocked(userService.getUserRoles).mockResolvedValue([{ role: 'manager' }] as any);
    const result = await runRosterAction({ ...base, action: 1, code: ' 812999000011 ', actingToken: 'eph:t' }, station);
    expect(result).toMatchObject({ status: 200, data: { outcome: 'completed', acting: { remaining: 0 } } });
    expect(resolveBatchItem).toHaveBeenCalledWith({
      id: 'match-1', itemKey: '00812999000011#1', resolverPayload: { source: 'key-in', enteredCode: '812999000011' },
    }, { userId: 'u-mgr' });
    expect(acting.refundActingGrant).not.toHaveBeenCalled();
  });

  it('returns the badge use when the act does not land', async () => {
    vi.mocked(acting.peekActingAuth).mockResolvedValue({ ok: true, auth: { userId: 'u-1' }, grant: {} } as any);
    vi.mocked(acting.consumeActingGrant).mockResolvedValue({ ok: true, auth: { userId: 'u-1' }, grant: { remaining: 1 } } as any);
    vi.mocked(flagBatchItem).mockResolvedValue({ status: 409, error: 'This item is already in' });
    const result = await runRosterAction({ ...base, actingToken: 'eph:t' }, station);
    expect(result.status).toBe(409);
    expect(acting.refundActingGrant).toHaveBeenCalledWith('eph:t', false);
  });

  it('answers not_primed for a dead badge', async () => {
    vi.mocked(acting.peekActingAuth).mockResolvedValue({ ok: false, error: 'expired' } as any);
    const result = await runRosterAction({ ...base, actingToken: 'eph:t' }, station);
    expect(result).toMatchObject({ status: 401, data: { outcome: 'not_primed' } });
  });

  it('resolves a query set entry’s member row with the payload interpolated against it', async () => {
    const querySchema = { properties: { orders: {
      'x-lt-roster': { expected: { query: { roles: ['packing'] } } },
      'x-lt-actions': [{ label: 'Missing', resolverPayload: { outcome: 'missing', order: '{{metadata.orderId}}' } }],
    } } };
    vi.mocked(escalationService.getEscalationWithFormSchema).mockResolvedValue({ escalation: host, form_schema: querySchema } as any);
    vi.mocked(loadRoster).mockResolvedValue({ entries: [{ key: 'o-1', state: 'waiting', row: { escalation: { id: 'm-1' }, metadata: { orderId: 'o-1' } } }] } as any);
    vi.mocked(resolveEscalation).mockResolvedValue({ status: 200, data: {} });
    await runRosterAction({ id: 'match-1', field: 'orders', action: 0, entry: 'o-1' }, station);
    expect(resolveEscalation).toHaveBeenCalledWith({ id: 'm-1', resolverPayload: { outcome: 'missing', order: 'o-1' } }, station);
  });

  it('reads the form a row embeds before the role form', async () => {
    vi.mocked(escalationService.getEscalationWithFormSchema).mockResolvedValue({
      escalation: { ...host, metadata: { form_schema: batchSchema } }, form_schema: { properties: {} },
    } as any);
    expect((await runRosterAction(base, station)).status).toBe(200);
  });
});
