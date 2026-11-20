import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { getInvalidationScheduler, REALTIME_REFRESH } from '../realtime-refresh';
import { DEFAULT_REFRESH_POLICY, resolveRefreshPolicy, setRefreshPolicy } from '../refresh-policy';

// The shared scheduler: coalesce, refractory cooldown, cross-hook dedupe,
// and zero network for hidden tabs.

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

let qc: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  setVisibility('visible');
});

afterEach(() => {
  setRefreshPolicy(DEFAULT_REFRESH_POLICY);
  getInvalidationScheduler(qc).dispose();
  vi.useRealTimers();
});

describe('coalesce + dedupe', () => {
  it('a burst lands as one flush; identical keys from different requests invalidate once', () => {
    const scheduler = getInvalidationScheduler(qc);
    const { coalesceMs } = REALTIME_REFRESH.LIST;

    scheduler.request('LIST', [['escalations']]);
    scheduler.request('LIST', [['escalations']]);   // a second hook, same key
    scheduler.request('LIST', [['jobs']]);
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(coalesceMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['escalations'] }, { cancelRefetch: false });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs'] }, { cancelRefetch: false });
  });

  it('a key wanted by two tiers flushes once, on the snappier lane', () => {
    const scheduler = getInvalidationScheduler(qc);

    scheduler.request('SUMMARY', [['escalationStats']]);
    scheduler.request('DETAIL', [['escalationStats']]);

    vi.advanceTimersByTime(REALTIME_REFRESH.DETAIL.coalesceMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // The SUMMARY lane's later flush finds nothing left to do.
    vi.advanceTimersByTime(REALTIME_REFRESH.SUMMARY.coalesceMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('refractory cooldown', () => {
  it('an event during cooldown produces exactly one trailing flush at the cooldown boundary', () => {
    const scheduler = getInvalidationScheduler(qc);
    const { coalesceMs, minIntervalMs } = REALTIME_REFRESH.DETAIL;

    scheduler.request('DETAIL', [['escalations', 'esc-1']]);
    vi.advanceTimersByTime(coalesceMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // Three events inside the cooldown — nothing may fire before it ends.
    scheduler.request('DETAIL', [['escalations', 'esc-1']]);
    vi.advanceTimersByTime(100);
    scheduler.request('DETAIL', [['escalations', 'esc-1']]);
    vi.advanceTimersByTime(100);
    scheduler.request('DETAIL', [['escalations', 'esc-1']]);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(minIntervalMs);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it('a sustained stream is bounded to one flush per interval and never starves', () => {
    const scheduler = getInvalidationScheduler(qc);
    const { coalesceMs, minIntervalMs } = REALTIME_REFRESH.LIST;

    // Stream spanning the coalesce window plus two refractory intervals.
    const totalMs = coalesceMs + 2 * minIntervalMs;
    for (let elapsed = 0; elapsed < totalMs; elapsed += 50) {
      scheduler.request('LIST', [['escalations']]);
      vi.advanceTimersByTime(50);
    }

    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });
});

describe('hidden tabs', () => {
  it('a hidden tab marks stale without network and catches up once on return', () => {
    const scheduler = getInvalidationScheduler(qc);
    const refetchSpy = vi.spyOn(qc, 'refetchQueries').mockResolvedValue();
    const { coalesceMs } = REALTIME_REFRESH.LIST;

    setVisibility('hidden');
    scheduler.request('LIST', [['escalations']]);
    vi.advanceTimersByTime(coalesceMs + 10);

    // Stale mark, zero network.
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: ['escalations'], refetchType: 'none' },
      { cancelRefetch: false },
    );
    expect(refetchSpy).not.toHaveBeenCalled();

    // One catch-up when someone looks again.
    setVisibility('visible');
    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(refetchSpy).toHaveBeenCalledWith({ type: 'active', stale: true });

    // A second visibility toggle with nothing stale does not refetch again.
    setVisibility('hidden');
    setVisibility('visible');
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('lanes', () => {
  it('a count and a list of the same family flush on their own lanes', () => {
    const scheduler = getInvalidationScheduler(qc);
    const count = ['escalations', 'available', { limit: 1 }];
    const list = ['escalations', { limit: 50 }];

    scheduler.request('SUMMARY', [count]);
    scheduler.request('LIST', [list]);

    vi.advanceTimersByTime(REALTIME_REFRESH.LIST.coalesceMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: list }, { cancelRefetch: false });

    vi.advanceTimersByTime(REALTIME_REFRESH.SUMMARY.coalesceMs);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenLastCalledWith({ queryKey: count }, { cancelRefetch: false });
  });
});

describe('in-flight queries', () => {
  it('a query that is still fetching waits for the next window instead of stacking', async () => {
    const scheduler = getInvalidationScheduler(qc);
    const key = ['escalations', { limit: 50 }];
    let release!: (value: unknown) => void;
    const inFlight = qc.fetchQuery({ queryKey: key, queryFn: () => new Promise((resolve) => { release = resolve; }) });

    scheduler.request('LIST', [key]);
    vi.advanceTimersByTime(REALTIME_REFRESH.LIST.coalesceMs + 10);
    expect(invalidateSpy).not.toHaveBeenCalled();

    release({ escalations: [] });
    await inFlight;

    vi.advanceTimersByTime(REALTIME_REFRESH.LIST.minIntervalMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: key }, { cancelRefetch: false });
  });
});

describe('refresh policy', () => {
  it('a deployment override changes the window the scheduler waits', () => {
    setRefreshPolicy(resolveRefreshPolicy({ list: { coalesceMs: 4_000, minIntervalMs: 15_000 } }));
    const scheduler = getInvalidationScheduler(qc);

    scheduler.request('LIST', [['escalations', { limit: 50 }]]);
    vi.advanceTimersByTime(REALTIME_REFRESH.LIST.coalesceMs + 10);
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4_000);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('a disabled policy marks queries stale and fetches nothing', () => {
    setRefreshPolicy(resolveRefreshPolicy({ enabled: false }));
    const scheduler = getInvalidationScheduler(qc);
    const refetchSpy = vi.spyOn(qc, 'refetchQueries').mockResolvedValue();

    scheduler.request('LIST', [['escalations']]);
    vi.advanceTimersByTime(REALTIME_REFRESH.LIST.coalesceMs + 10);

    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: ['escalations'], refetchType: 'none' },
      { cancelRefetch: false },
    );
    setVisibility('hidden');
    setVisibility('visible');
    expect(refetchSpy).not.toHaveBeenCalled();
  });
});

describe('events already covered by a fetch', () => {
  const key = ['escalations', 'esc-1'];

  beforeEach(() => {
    qc.setQueryDefaults(key, { gcTime: Infinity });
  });

  it('skips an event when the query began fetching after the event arrived', async () => {
    const scheduler = getInvalidationScheduler(qc);
    await qc.fetchQuery({ queryKey: key, queryFn: () => ({ id: 'esc-1' }) });

    scheduler.request('DETAIL', [key]);
    vi.advanceTimersByTime(10);
    await qc.refetchQueries({ queryKey: key });

    vi.advanceTimersByTime(REALTIME_REFRESH.DETAIL.coalesceMs + 10);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('still refreshes when the last fetch began before the event arrived', async () => {
    const scheduler = getInvalidationScheduler(qc);
    await qc.fetchQuery({ queryKey: key, queryFn: () => ({ id: 'esc-1' }) });

    vi.advanceTimersByTime(10);
    scheduler.request('DETAIL', [key]);

    vi.advanceTimersByTime(REALTIME_REFRESH.DETAIL.coalesceMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('a later event refreshes even after an earlier one was covered', async () => {
    const scheduler = getInvalidationScheduler(qc);
    await qc.fetchQuery({ queryKey: key, queryFn: () => ({ id: 'esc-1' }) });

    scheduler.request('DETAIL', [key]);
    vi.advanceTimersByTime(10);
    await qc.refetchQueries({ queryKey: key });
    vi.advanceTimersByTime(REALTIME_REFRESH.DETAIL.coalesceMs + 10);
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    scheduler.request('DETAIL', [key]);
    vi.advanceTimersByTime(REALTIME_REFRESH.DETAIL.minIntervalMs + 10);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
