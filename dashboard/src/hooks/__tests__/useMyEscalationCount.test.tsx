import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { REALTIME_REFRESH, getInvalidationScheduler } from '../../lib/realtime-refresh';
import { useMyEscalationCount } from '../useMyEscalationCount';

// ── Mocks ────────────────────────────────────────────────────────────────────

type Handler = (event: any) => void;
const subscriptions: Array<{ pattern: string; handler: Handler }> = [];

vi.mock('../useEventContext', () => ({
  useEventSubscriptions: (patterns: string[], handler: Handler) => {
    for (const pattern of patterns) subscriptions.push({ pattern, handler });
  },
}));

const authState: { user: { userId?: string; roles: unknown[] } | null } = {
  user: { userId: 'user-1', roles: [] },
};
vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('../useMemberEscalationPatterns', () => ({
  useMemberEscalationPatterns: () => ['lt.events.system.escalation.>'],
}));

vi.mock('../../api/escalations', () => ({
  useEscalations: () => ({ data: { total: 3 } }),
}));

let qc: QueryClient;

function createWrapper() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const SUMMARY_FLUSH_MS = REALTIME_REFRESH.SUMMARY.coalesceMs + 50;

beforeEach(() => {
  subscriptions.length = 0;
  authState.user = { userId: 'user-1', roles: [] };
  vi.useFakeTimers();
});

afterEach(() => {
  getInvalidationScheduler(qc).dispose();
  vi.useRealTimers();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useMyEscalationCount', () => {
  it('returns the total from the assigned-to-me count query', () => {
    const { result } = renderHook(() => useMyEscalationCount(), { wrapper: createWrapper() });
    expect(result.current).toBe(3);
  });

  it('never invalidates synchronously per event — a burst lands as one SUMMARY-tier flush', () => {
    const Wrapper = createWrapper();
    renderHook(() => useMyEscalationCount(), { wrapper: Wrapper });
    const spy = vi.spyOn(qc, 'invalidateQueries');

    act(() => {
      for (let i = 0; i < 50; i++) subscriptions[0].handler({ type: 'system.escalation.x' });
    });
    expect(spy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SUMMARY_FLUSH_MS);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations'] });
  });

  it('does not invalidate when no user is signed in', () => {
    authState.user = null;
    const Wrapper = createWrapper();
    renderHook(() => useMyEscalationCount(), { wrapper: Wrapper });
    const spy = vi.spyOn(qc, 'invalidateQueries');

    act(() => {
      subscriptions[0].handler({ type: 'system.escalation.x' });
      vi.advanceTimersByTime(SUMMARY_FLUSH_MS);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
