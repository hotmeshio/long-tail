import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/iam/acting-identity', () => ({
  peekActingAuth: vi.fn(),
  consumeActingGrant: vi.fn(),
  refundActingGrant: vi.fn(),
}));

import * as acting from '../../services/iam/acting-identity';
import { peekGrant, settleGrant, spendGrant } from '../../api/scan-codes/grant';
import { SCAN_OUTCOMES } from '../../types';

const iam = vi.mocked(acting);
const TOKEN = 'eph:v1:acting_identity:x';

const ctx = (over: Record<string, unknown> = {}) => ({
  rule: { notPrimed: { markdown: 'Scan your badge' } },
  grant: { token: TOKEN, peeked: { remaining: 1, bound: false }, spent: null },
  ...over,
}) as any;

const executed = (verb: string, extra: Record<string, unknown> = {}) =>
  ({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, verb, ...extra } }) as any;

beforeEach(() => vi.clearAllMocks());

describe('peekGrant', () => {
  it('reads the grant into a ledger without spending', async () => {
    iam.peekActingAuth.mockResolvedValue({ ok: true, auth: { userId: 'maria' }, grant: { consumed: false, remaining: 1, bound: false } });
    const result = await peekGrant(TOKEN);
    expect(result).toEqual({
      ok: true, auth: { userId: 'maria' },
      grant: { token: TOKEN, peeked: { remaining: 1, bound: false }, spent: null },
    });
    expect(iam.consumeActingGrant).not.toHaveBeenCalled();
  });
});

describe('spendGrant', () => {
  it('spends once per request, keyed to the held subject', async () => {
    iam.consumeActingGrant.mockResolvedValue({ ok: true, auth: { userId: 'maria' }, grant: { consumed: true, remaining: 0, bound: false } });
    const c = ctx({ subject: { row: { id: 'bag-row' } } });
    expect(await spendGrant(c)).toBeNull();
    expect(await spendGrant(c)).toBeNull();
    expect(iam.consumeActingGrant).toHaveBeenCalledTimes(1);
    expect(iam.consumeActingGrant).toHaveBeenCalledWith(TOKEN, 'bag-row');
  });

  it('no grant riding the request means nothing to spend', async () => {
    expect(await spendGrant(ctx({ grant: undefined }))).toBeNull();
    expect(iam.consumeActingGrant).not.toHaveBeenCalled();
  });

  it('a grant that cannot cover the act is a replayable not-primed', async () => {
    iam.consumeActingGrant.mockResolvedValue({ ok: false, error: 'this badge already acted on another item; scan your badge again' });
    const result = await spendGrant(ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.NOT_PRIMED, replayable: true, error: expect.stringMatching(/another item/) });
  });
});

describe('settleGrant', () => {
  it('a landed write keeps the spend and reports what is left', async () => {
    const c = ctx();
    c.grant.spent = { remaining: 0, bound: false };
    expect(await settleGrant(c, executed('accumulate'))).toEqual({ consumed: true, remaining: 0, bound: false });
    expect(iam.refundActingGrant).not.toHaveBeenCalled();
  });

  it('a spend whose act missed or refused is refunded, binding included', async () => {
    const c = ctx();
    c.grant.spent = { remaining: null, bound: true };
    const result = await settleGrant(c, { status: 200, data: { outcome: SCAN_OUTCOMES.REFUSED } } as any);
    expect(iam.refundActingGrant).toHaveBeenCalledWith(TOKEN, true);
    expect(result).toEqual({ consumed: false, remaining: 1, bound: false });
  });

  it('an idempotent "already there" add is refunded', async () => {
    const c = ctx();
    c.grant.spent = { remaining: 0, bound: false };
    await settleGrant(c, executed('accumulate', { already: true }));
    expect(iam.refundActingGrant).toHaveBeenCalledWith(TOKEN, false);
  });

  it('a grant bound before this request spent nothing, so nothing is refunded', async () => {
    const c = ctx({ grant: { token: TOKEN, peeked: { remaining: null, bound: true }, spent: { remaining: null, bound: true } } });
    await settleGrant(c, null);
    expect(iam.refundActingGrant).not.toHaveBeenCalled();
  });

  it('a show or hold reports the grant untouched', async () => {
    expect(await settleGrant(ctx(), executed('show-detail'))).toEqual({ consumed: false, remaining: 1, bound: false });
  });
});
