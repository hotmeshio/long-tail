import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';

// The provider registers the grant with the API client; spy on that surface.
vi.mock('../../api/client', () => ({
  setActingTokenProvider: vi.fn(),
  setActingIdentityClear: vi.fn(),
  setActingIdentitySpent: vi.fn(),
}));

import { ActingIdentityProvider, useActingIdentity } from '../useActingIdentity';
import { setActingTokenProvider, setActingIdentityClear, setActingIdentitySpent } from '../../api/client';
import type { ScanExecuteResponse } from '../../api/scan-codes';

function primedResponse(token: string, displayName: string, ttlMs: number, maxUses?: number): ScanExecuteResponse {
  return {
    outcome: 'identity_primed',
    actor: { id: `id-${displayName}`, displayName },
    actingToken: token,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    ...(maxUses !== undefined ? { maxUses } : {}),
  };
}

/** The spent callback the provider registered with the API client. */
function spentHook(): (token: string, remaining: number | null) => void {
  const calls = vi.mocked(setActingIdentitySpent).mock.calls;
  const fn = calls[calls.length - 1]?.[0];
  if (!fn) throw new Error('provider did not register a spent hook');
  return fn;
}

function wrapper({ children }: { children: ReactNode }) {
  return <ActingIdentityProvider>{children}</ActingIdentityProvider>;
}

describe('useActingIdentity', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with no identity', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    expect(result.current.identity).toBeNull();
    expect(result.current.remainingSeconds()).toBe(0);
  });

  it('primes from an identity_primed response', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000)); });
    expect(result.current.identity).toMatchObject({
      actingToken: 'eph:v1:acting_identity:a',
      displayName: 'Dana',
    });
    expect(result.current.remainingSeconds()).toBe(60);
  });

  it('stores the actor id from the response', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000)); });
    expect(result.current.identity?.actorId).toBe('id-Dana');
  });

  it('registers a live token provider and its clear callback with the API client', () => {
    const { result, unmount } = renderHook(() => useActingIdentity(), { wrapper });
    // The freshest registration belongs to this provider instance.
    const providerFn = vi.mocked(setActingTokenProvider).mock.lastCall![0]!;
    const clearFn = vi.mocked(setActingIdentityClear).mock.lastCall![0]!;

    // The provider reflects the grant lifecycle: null → token → null.
    expect(providerFn()).toBeNull();
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000)); });
    expect(providerFn()).toBe('eph:v1:acting_identity:a');

    // The registered clear drops the identity (the acting-401 path).
    act(() => { clearFn(); });
    expect(result.current.identity).toBeNull();
    expect(providerFn()).toBeNull();

    // Unmount unregisters both.
    unmount();
    expect(vi.mocked(setActingTokenProvider).mock.lastCall?.[0]).toBeNull();
    expect(vi.mocked(setActingIdentityClear).mock.lastCall?.[0]).toBeNull();
  });

  it('returns null from the first prime and the replaced token on re-prime', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    let first: string | null = 'sentinel';
    act(() => { first = result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000)); });
    expect(first).toBeNull();

    let previous: string | null = null;
    act(() => { previous = result.current.prime(primedResponse('eph:v1:acting_identity:b', 'Sam', 60_000)); });
    expect(previous).toBe('eph:v1:acting_identity:a');
    expect(result.current.identity?.displayName).toBe('Sam');
  });

  it('ignores a response without a grant', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    let returned: string | null = 'sentinel';
    act(() => { returned = result.current.prime({ outcome: 'executed' }); });
    expect(returned).toBeNull();
    expect(result.current.identity).toBeNull();
  });

  it('clears itself at the expiry instant', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 30_000)); });
    expect(result.current.identity).not.toBeNull();

    act(() => { vi.advanceTimersByTime(29_000); });
    expect(result.current.identity).not.toBeNull();

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current.identity).toBeNull();
  });

  it('a re-prime resets the expiry timeout', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 10_000)); });
    act(() => { vi.advanceTimersByTime(8_000); });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:b', 'Dana', 30_000)); });

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current.identity?.actingToken).toBe('eph:v1:acting_identity:b');

    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.identity).toBeNull();
  });

  it('clear() drops the identity immediately', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000)); });
    act(() => { result.current.clear(); });
    expect(result.current.identity).toBeNull();
    expect(result.current.remainingSeconds()).toBe(0);
  });

  // ── Retirement follows the server ──────────────────────────────────────────
  // The client drops its grant only when the server reports none left: a read
  // never spends it, and a newer grant is never dropped for a stale token.

  it('records whether a grant binds to one subject', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime({ ...primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000, 1), grantScope: 'subject' }); });
    expect(result.current.identity?.subjectScoped).toBe(true);
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:b', 'Sam', 60_000, 0)); });
    expect(result.current.identity?.subjectScoped).toBe(false);
  });

  it('retires the grant when a work route reports no uses left, and keeps it otherwise', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000, 2)); });
    act(() => { spentHook()('eph:v1:acting_identity:a', 1); });
    expect(result.current.identity?.displayName).toBe('Dana');
    act(() => { spentHook()('eph:v1:acting_identity:a', null); });
    expect(result.current.identity?.displayName).toBe('Dana');
    act(() => { spentHook()('eph:v1:acting_identity:a', 0); });
    expect(result.current.identity).toBeNull();
  });

  it('never drops a newer grant on a stale token', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000, 1)); });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:b', 'Sam', 60_000, 1)); });
    act(() => { spentHook()('eph:v1:acting_identity:a', 0); });
    expect(result.current.identity?.displayName).toBe('Sam');
  });

  it('settle retires a grant a scan used up, or a bound grant whose subject is done', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    const token = 'eph:v1:acting_identity:a';
    act(() => { result.current.prime(primedResponse(token, 'Dana', 60_000, 1)); });
    act(() => { result.current.settle(token, { outcome: 'held', acting: { consumed: false, remaining: 1, bound: false } }); });
    expect(result.current.identity?.displayName).toBe('Dana');
    act(() => { result.current.settle(token, { outcome: 'executed', acting: { consumed: true, remaining: 0, bound: false } }); });
    expect(result.current.identity).toBeNull();

    act(() => { result.current.prime(primedResponse(token, 'Dana', 60_000, 1)); });
    act(() => { result.current.settle(token, { outcome: 'executed', progress: { filled: 1, total: 2, remaining: 1 }, acting: { consumed: true, remaining: null, bound: true } }); });
    expect(result.current.identity?.displayName).toBe('Dana');
    act(() => { result.current.settle(token, { outcome: 'executed', clearSubject: true, acting: { consumed: true, remaining: null, bound: true } }); });
    expect(result.current.identity).toBeNull();
  });
});
