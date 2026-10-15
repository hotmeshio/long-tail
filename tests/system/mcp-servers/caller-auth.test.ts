import { describe, it, expect, vi } from 'vitest';

const ensureSystemBot = vi.hoisted(() => vi.fn(async () => '11111111-1111-1111-1111-111111111111'));
vi.mock('../../../services/iam', () => ({ ensureSystemBot }));

import { callerAuth, externalCaller, systemAuth } from '../../../system/mcp-servers/caller-auth';

const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'member' };

describe('caller-auth', () => {
  it('externalCaller returns the forwarded /mcp auth', () => {
    expect(externalCaller({ authInfo: CALLER })).toBe(CALLER);
  });

  it('externalCaller ignores a missing extra or an auth without a user id', () => {
    expect(externalCaller()).toBeUndefined();
    expect(externalCaller({})).toBeUndefined();
    expect(externalCaller({ authInfo: { token: 't', scopes: [] } })).toBeUndefined();
  });

  it('callerAuth prefers the external caller', async () => {
    expect(await callerAuth({ authInfo: CALLER })).toBe(CALLER);
  });

  it('callerAuth falls back to lt-system and resolves its id once', async () => {
    const expected = { userId: '11111111-1111-1111-1111-111111111111', role: 'superadmin' };
    expect(await callerAuth()).toEqual(expected);
    expect(await systemAuth()).toEqual(expected);
    expect(ensureSystemBot).toHaveBeenCalledTimes(1);
  });
});
