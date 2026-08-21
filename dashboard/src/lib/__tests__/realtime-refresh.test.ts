import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { getInvalidationScheduler, REALTIME_REFRESH } from '../realtime-refresh';

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
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['escalations'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
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
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['escalations'],
      refetchType: 'none',
    });
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
