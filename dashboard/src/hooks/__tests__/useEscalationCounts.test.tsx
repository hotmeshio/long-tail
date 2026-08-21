import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { REALTIME_REFRESH, getInvalidationScheduler } from '../../lib/realtime-refresh';
import { useEscalationCounts } from '../useEscalationCounts';

// ── Mocks ────────────────────────────────────────────────────────────────────

type Handler = (event: any) => void;
const subscriptions: Array<{ pattern: string; handler: Handler }> = [];

vi.mock('../useEventContext', () => ({
  useEventSubscriptions: (patterns: string[], handler: Handler) => {
    for (const pattern of patterns) subscriptions.push({ pattern, handler });
  },
}));

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { userId: 'user-1', roles: [] } }),
}));

vi.mock('../useMemberEscalationPatterns', () => ({
  useMemberEscalationPatterns: () => ['lt.events.system.escalation.>'],
}));

vi.mock('../../api/escalations', () => ({
  useEscalations: () => ({ data: { total: 4 } }),
  useAvailableEscalations: () => ({ data: { total: 9 } }),
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
  vi.useFakeTimers();
});

afterEach(() => {
  getInvalidationScheduler(qc).dispose();
  vi.useRealTimers();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useEscalationCounts', () => {
  it('returns the available and mine totals from the count queries', () => {
    const { result } = renderHook(() => useEscalationCounts(), { wrapper: createWrapper() });
    expect(result.current).toEqual({ available: 9, mine: 4 });
  });

  it('subscribes to the member escalation patterns', () => {
    renderHook(() => useEscalationCounts(), { wrapper: createWrapper() });
    expect(subscriptions.map((s) => s.pattern)).toContain('lt.events.system.escalation.>');
  });

  it('never invalidates synchronously per event — a burst lands as one SUMMARY-tier flush', () => {
    const Wrapper = createWrapper();
    renderHook(() => useEscalationCounts(), { wrapper: Wrapper });
    const spy = vi.spyOn(qc, 'invalidateQueries');

    // A simulation-grade burst: many events inside one coalesce window.
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

  it('a sustained event stream stays bounded by the SUMMARY refractory floor', () => {
    const Wrapper = createWrapper();
    renderHook(() => useEscalationCounts(), { wrapper: Wrapper });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { coalesceMs, minIntervalMs } = REALTIME_REFRESH.SUMMARY;

    act(() => {
      const totalMs = coalesceMs + 2 * minIntervalMs;
      for (let elapsed = 0; elapsed < totalMs; elapsed += 100) {
        subscriptions[0].handler({ type: 'system.escalation.x' });
        vi.advanceTimersByTime(100);
      }
    });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
