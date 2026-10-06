import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/user', () => ({ getUser: vi.fn() }));
vi.mock('../../../services/iam/ephemeral', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  peekEphemeral: vi.fn(),
  consumeEphemeral: vi.fn(),
  refundEphemeral: vi.fn(),
}));

import * as userService from '../../../services/user';
import * as eph from '../../../services/iam/ephemeral';
import {
  ACTING_ERRORS,
  consumeActingGrant,
  peekActingAuth,
  refundActingGrant,
} from '../../../services/iam/acting-identity';

const UUID = '11111111-1111-4111-8111-111111111111';
const TOKEN = `eph:v1:acting_identity:${UUID}`;
const store = vi.mocked(eph);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.getUser).mockResolvedValue({ id: 'maria', status: 'active' } as any);
});

describe('peekActingAuth', () => {
  it('reads the grant into the person without spending it', async () => {
    store.peekEphemeral.mockResolvedValue({ value: 'maria', remaining: 1, bound: false });
    expect(await peekActingAuth(TOKEN)).toEqual({
      ok: true, auth: { userId: 'maria' }, grant: { consumed: false, remaining: 1, bound: false },
    });
    expect(store.consumeEphemeral).not.toHaveBeenCalled();
  });

  it('an expired grant or the wrong label is a loud failure', async () => {
    store.peekEphemeral.mockResolvedValue(null);
    expect(await peekActingAuth(TOKEN)).toEqual({ ok: false, error: ACTING_ERRORS.EXPIRED });
    expect(await peekActingAuth(`eph:v1:llm_password:${UUID}`)).toEqual({ ok: false, error: ACTING_ERRORS.NOT_A_GRANT });
  });
});

describe('consumeActingGrant', () => {
  it('spends one use for the subject it lands on', async () => {
    store.consumeEphemeral.mockResolvedValue({ value: 'maria', remaining: null, bound: true });
    expect(await consumeActingGrant(TOKEN, 'bag-row')).toMatchObject({ ok: true, grant: { consumed: true, bound: true } });
    expect(store.consumeEphemeral).toHaveBeenCalledWith(UUID, 'bag-row');
  });

  it('a grant bound to another item says so; an exhausted one says scan again', async () => {
    store.consumeEphemeral.mockResolvedValue(null);
    store.peekEphemeral.mockResolvedValue({ value: 'maria', remaining: null, bound: true });
    expect(await consumeActingGrant(TOKEN, 'other-row')).toEqual({ ok: false, error: ACTING_ERRORS.OTHER_SUBJECT });
    store.peekEphemeral.mockResolvedValue(null);
    expect(await consumeActingGrant(TOKEN, 'other-row')).toEqual({ ok: false, error: ACTING_ERRORS.EXPIRED });
  });

  it('an inactive person never acts', async () => {
    store.consumeEphemeral.mockResolvedValue({ value: 'maria', remaining: 0, bound: false });
    vi.mocked(userService.getUser).mockResolvedValue({ id: 'maria', status: 'suspended' } as any);
    expect(await consumeActingGrant(TOKEN)).toEqual({ ok: false, error: ACTING_ERRORS.INACTIVE });
  });
});

describe('refundActingGrant', () => {
  it('returns the use, and the binding when asked', async () => {
    await refundActingGrant(TOKEN, true);
    expect(store.refundEphemeral).toHaveBeenCalledWith(UUID, true);
  });
});
