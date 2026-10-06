import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation', () => ({ getEscalation: vi.fn() }));
vi.mock('../../services/user', () => ({ getUser: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({ assertReadAccess: vi.fn() }));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { assertReadAccess } from '../../api/escalations/helpers';
import { claimedByOther, resolveSubject } from '../../api/scan-codes/subject';
import type { ScanScheme } from '../../types';

const esc = vi.mocked(escalationService);
const users = vi.mocked(userService);
const readAccess = vi.mocked(assertReadAccess);

const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BAG: ScanScheme = {
  version: 11, name: 'Bag', description: null, target_facet: 'orderSlug', encoding: 'delimited', delimiter: ':',
  target_length: null, kind: 'action', grant_ttl_seconds: null, grant_max_uses: 0, grant_scope: 'action', enabled: true,
};
const BADGE: ScanScheme = { ...BAG, version: 12, kind: 'identity', target_facet: 'badge_id' };
const station = { userId: 'station-1' };
const bagRow = (over: Record<string, unknown> = {}) =>
  ({ id: ROW_ID, role: 'binning-associate', status: 'pending', metadata: { orderSlug: 'K7Q2M9XA', binCode: 'SF-A-2' }, ...over }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  readAccess.mockResolvedValue(null);
});

describe('resolveSubject — the pointer is never authority', () => {
  it('no pointer, no subject', async () => {
    expect(await resolveSubject(undefined, [BAG], station)).toBeNull();
  });

  it('re-derives the subject from code + row', async () => {
    esc.getEscalation.mockResolvedValue(bagRow());
    const result = await resolveSubject({ code: '11:0:K7Q2M9XA', escalationId: ROW_ID }, [BAG], station);
    expect(result).toMatchObject({ ok: true, subject: { code: '11:0:K7Q2M9XA', parsed: { target: 'K7Q2M9XA' }, scheme: { version: 11 } } });
  });

  it('a non-uuid id never reaches SQL', async () => {
    expect(await resolveSubject({ code: '11:0:K7Q2M9XA', escalationId: 'nope' }, [BAG], station)).toEqual({ ok: false });
    expect(esc.getEscalation).not.toHaveBeenCalled();
  });

  it('an id that does not carry the code is stale (no borrowing another bag)', async () => {
    esc.getEscalation.mockResolvedValue(bagRow({ metadata: { orderSlug: 'OTHERBAG' } }));
    expect(await resolveSubject({ code: '11:0:K7Q2M9XA', escalationId: ROW_ID }, [BAG], station)).toEqual({ ok: false });
  });

  it('a row that moved on, or that the station cannot read, is stale', async () => {
    esc.getEscalation.mockResolvedValue(bagRow({ status: 'resolved' }));
    expect(await resolveSubject({ code: '11:0:K7Q2M9XA', escalationId: ROW_ID }, [BAG], station)).toEqual({ ok: false });
    esc.getEscalation.mockResolvedValue(bagRow());
    readAccess.mockResolvedValue({ status: 403, error: 'no' });
    expect(await resolveSubject({ code: '11:0:K7Q2M9XA', escalationId: ROW_ID }, [BAG], station)).toEqual({ ok: false });
  });

  it('a badge is never a subject', async () => {
    expect(await resolveSubject({ code: '12:0:HB-1', escalationId: ROW_ID }, [BADGE], station)).toEqual({ ok: false });
  });
});

describe('claimedByOther', () => {
  const future = new Date(Date.now() + 60_000);

  it('names someone else holding a live claim', async () => {
    users.getUser.mockResolvedValue({ display_name: 'Maria' } as any);
    const row = bagRow({ assigned_to: 'maria', assigned_until: future });
    expect(await claimedByOther(row, 'sam')).toEqual({ id: 'maria', displayName: 'Maria' });
  });

  it('the actor\'s own claim, no claim, or an expired claim is not "someone else"', async () => {
    expect(await claimedByOther(bagRow({ assigned_to: 'maria', assigned_until: future }), 'maria')).toBeNull();
    expect(await claimedByOther(bagRow(), 'sam')).toBeNull();
    const past = new Date(Date.now() - 60_000);
    expect(await claimedByOther(bagRow({ assigned_to: 'maria', assigned_until: past }), 'sam')).toBeNull();
  });
});
