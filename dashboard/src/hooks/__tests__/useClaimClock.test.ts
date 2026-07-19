import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useClaimClock, CLAIM_WARNING_MS } from '../useClaimClock';

function inFutureMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

describe('useClaimClock', () => {
  beforeEach(() => {
    // Fake Date too: the hook derives state from Date.now() at render time,
    // so the clock must advance in step with the timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports no claim state when assignedUntil is absent', () => {
    const { result } = renderHook(() => useClaimClock(null));
    expect(result.current).toEqual({ expired: false, expiringSoon: false, msRemaining: 0 });
  });

  it('reports a healthy claim outside the warning window', () => {
    const until = inFutureMs(10 * 60_000);
    const { result } = renderHook(() => useClaimClock(until));
    expect(result.current.expired).toBe(false);
    expect(result.current.expiringSoon).toBe(false);
    expect(result.current.msRemaining).toBeGreaterThan(CLAIM_WARNING_MS);
  });

  it('re-renders into the warning window when the threshold timer fires', () => {
    const until = inFutureMs(CLAIM_WARNING_MS + 5_000);
    const { result } = renderHook(() => useClaimClock(until));
    expect(result.current.expiringSoon).toBe(false);

    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.expiringSoon).toBe(true);
    expect(result.current.expired).toBe(false);
  });

  it('re-renders into the expired state when the claim lapses', () => {
    const until = inFutureMs(CLAIM_WARNING_MS + 5_000);
    const { result } = renderHook(() => useClaimClock(until));

    act(() => { vi.advanceTimersByTime(CLAIM_WARNING_MS + 5_000); });
    expect(result.current.expired).toBe(true);
    expect(result.current.expiringSoon).toBe(false);
    expect(result.current.msRemaining).toBe(0);
  });

  it('starts inside the warning window for a short claim', () => {
    const until = inFutureMs(30_000);
    const { result } = renderHook(() => useClaimClock(until));
    expect(result.current.expiringSoon).toBe(true);
  });

  it('reports expired immediately for a past timestamp', () => {
    const { result } = renderHook(() =>
      useClaimClock(new Date(Date.now() - 60_000).toISOString()),
    );
    expect(result.current.expired).toBe(true);
    expect(result.current.expiringSoon).toBe(false);
  });

  it('resets the cycle when assignedUntil moves forward (claim extended)', () => {
    let until = inFutureMs(CLAIM_WARNING_MS + 5_000);
    const { result, rerender } = renderHook(() => useClaimClock(until));

    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.expiringSoon).toBe(true);

    // Extension: new expiry well outside the warning window
    until = inFutureMs(30 * 60_000);
    rerender();
    expect(result.current.expiringSoon).toBe(false);
    expect(result.current.expired).toBe(false);
  });

  it('honors a custom warning window', () => {
    const { result } = renderHook(() => useClaimClock(inFutureMs(4_000), 5_000));
    expect(result.current.expiringSoon).toBe(true);
  });
});
