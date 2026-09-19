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
function spentHook(): (token: string) => void {
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

  // ── Single-shot grants ──────────────────────────────────────────────────────
  // The server exchanges a max-uses-1 grant exactly once. Holding the client
  // copy past that request leaves every later scan carrying a dead token.

  it('marks a maxUses 1 grant single-use and a TTL grant not', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000, 1)); });
    expect(result.current.identity?.singleUse).toBe(true);
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:b', 'Sam', 60_000, 0)); });
    expect(result.current.identity?.singleUse).toBe(false);
  });

  it('retires a single-use grant the moment a request carrying it returns', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000, 1)); });
    act(() => { spentHook()('eph:v1:acting_identity:a'); });
    expect(result.current.identity).toBeNull();
  });

  it('keeps a TTL grant across requests and never drops a newer grant on a stale token', () => {
    const { result } = renderHook(() => useActingIdentity(), { wrapper });
    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:a', 'Dana', 60_000, 0)); });
    act(() => { spentHook()('eph:v1:acting_identity:a'); });
    expect(result.current.identity?.displayName).toBe('Dana');

    act(() => { result.current.prime(primedResponse('eph:v1:acting_identity:b', 'Sam', 60_000, 1)); });
    act(() => { spentHook()('eph:v1:acting_identity:a'); });
    expect(result.current.identity?.displayName).toBe('Sam');
  });
});
