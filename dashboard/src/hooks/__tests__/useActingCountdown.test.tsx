import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../../api/client', () => ({
  setActingTokenProvider: vi.fn(),
  setActingIdentityClear: vi.fn(),
  setActingIdentitySpent: vi.fn(),
}));

import { ActingIdentityProvider, useActingIdentity } from '../useActingIdentity';
import { useActingCountdown } from '../useActingCountdown';
import type { ScanExecuteResponse } from '../../api/scan-codes';

function wrapper({ children }: { children: ReactNode }) {
  return <ActingIdentityProvider>{children}</ActingIdentityProvider>;
}

function primed(ttlMs: number): ScanExecuteResponse {
  return {
    outcome: 'identity_primed',
    actor: { id: 'id-dana', displayName: 'Dana' },
    actingToken: 'eph:v1:acting_identity:a',
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

describe('useActingCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is 0 with no grant', () => {
    const { result } = renderHook(() => useActingCountdown(), { wrapper });
    expect(result.current).toBe(0);
  });

  it('re-renders each second with the seconds left', () => {
    const { result } = renderHook(() => ({ seconds: useActingCountdown(), acting: useActingIdentity() }), { wrapper });
    act(() => { result.current.acting.prime(primed(10_000)); });
    expect(result.current.seconds).toBe(10);
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(result.current.seconds).toBe(7);
  });

  it('returns to 0 when the grant lapses', () => {
    const { result } = renderHook(() => ({ seconds: useActingCountdown(), acting: useActingIdentity() }), { wrapper });
    act(() => { result.current.acting.prime(primed(2_000)); });
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.acting.identity).toBeNull();
    expect(result.current.seconds).toBe(0);
  });
});
