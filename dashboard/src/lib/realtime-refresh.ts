/**
 * Realtime refresh discipline — every event→refetch tunable lives here.
 *
 * The dashboard is push-driven: broker events invalidate React Query keys and
 * the active queries refetch. Unbounded, a heavy event stream turns every
 * mounted surface into a continuous query stream. This module bounds it:
 *
 *   - Each query key flushes through ONE shared scheduler per QueryClient —
 *     the same key requested by several hooks in a window invalidates once.
 *   - Each tier has a COALESCE window (a burst lands as one flush) and a
 *     MIN-INTERVAL refractory floor (after a flush, the next waits at least
 *     this long however many events arrive — trailing edge, so sustained load
 *     neither starves nor exceeds the bound). Worst-case per-surface refetch
 *     rate is exactly 1 / minIntervalMs.
 *   - A HIDDEN tab never refetches: flushes mark queries stale without
 *     network (refetchType 'none'), and one catch-up refetch runs when the
 *     tab becomes visible again.
 */
import type { QueryClient } from '@tanstack/react-query';

/** Per-tier discipline. Tune here — nothing else in the event path carries a number. */
export const REALTIME_REFRESH = {
  /** One record's page — the snappiest surface. */
  DETAIL: { coalesceMs: 300, minIntervalMs: 2_000 },
  /** Queues and job lists. */
  LIST: { coalesceMs: 500, minIntervalMs: 3_000 },
  /** Aggregates: pace board metrics, stats, mix/timeline analytics. */
  SUMMARY: { coalesceMs: 1_000, minIntervalMs: 10_000 },
} as const;

export type RefreshTier = keyof typeof REALTIME_REFRESH;

/** The input-debounce twin (search boxes, find-as-you-type), centralized. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Snappiest first — a key requested by two tiers flushes on the snappier lane. */
const TIER_RANK: Record<RefreshTier, number> = { DETAIL: 0, LIST: 1, SUMMARY: 2 };

export interface InvalidationScheduler {
  /** Queue query keys for a tier-bounded batch invalidation. */
  request(tier: RefreshTier, keys: ReadonlyArray<ReadonlyArray<string>>): void;
  /** Detach timers and the visibility listener (tests). */
  dispose(): void;
}

function createInvalidationScheduler(qc: QueryClient): InvalidationScheduler {
  // One pending map across every hook: serialized key → the snappiest tier
  // that asked for it. Flushing a lane takes only its own keys.
  const pending = new Map<string, RefreshTier>();
  const timers: Partial<Record<RefreshTier, ReturnType<typeof setTimeout>>> = {};
  const lastFlushAt: Partial<Record<RefreshTier, number>> = {};
  let staleWhileHidden = false;

  const isHidden = () =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden';

  function flush(tier: RefreshTier): void {
    delete timers[tier];
    lastFlushAt[tier] = Date.now();
    const batch: string[] = [];
    for (const [raw, keyTier] of pending) {
      if (keyTier === tier) batch.push(raw);
    }
    for (const raw of batch) pending.delete(raw);
    if (batch.length === 0) return;

    // Hidden tabs mark stale without network; the catch-up runs on return.
    const hidden = isHidden();
    if (hidden) staleWhileHidden = true;
    for (const raw of batch) {
      qc.invalidateQueries({
        queryKey: JSON.parse(raw),
        ...(hidden ? { refetchType: 'none' as const } : {}),
      });
    }
  }

  function schedule(tier: RefreshTier): void {
    if (timers[tier]) return; // a flush is already on the way for this lane
    const { coalesceMs, minIntervalMs } = REALTIME_REFRESH[tier];
    const last = lastFlushAt[tier];
    const cooldownRemaining = last === undefined ? 0 : last + minIntervalMs - Date.now();
    const delay = Math.max(coalesceMs, cooldownRemaining);
    timers[tier] = setTimeout(() => flush(tier), delay);
  }

  function request(tier: RefreshTier, keys: ReadonlyArray<ReadonlyArray<string>>): void {
    for (const key of keys) {
      const raw = JSON.stringify(key);
      const existing = pending.get(raw);
      if (existing === undefined || TIER_RANK[tier] < TIER_RANK[existing]) {
        pending.set(raw, tier);
      }
    }
    schedule(tier);
  }

  const onVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible' && staleWhileHidden) {
      staleWhileHidden = false;
      // One catch-up: the hidden-time invalidations already marked queries
      // stale; refetch the active ones now that someone is looking.
      void qc.refetchQueries({ type: 'active', stale: true });
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    request,
    dispose() {
      for (const tier of Object.keys(timers) as RefreshTier[]) {
        const timer = timers[tier];
        if (timer) clearTimeout(timer);
        delete timers[tier];
      }
      pending.clear();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
  };
}

// One scheduler per QueryClient — every hook shares it, so identical keys
// coalesce across hooks and the tier bounds hold client-wide.
const schedulers = new WeakMap<QueryClient, InvalidationScheduler>();

export function getInvalidationScheduler(qc: QueryClient): InvalidationScheduler {
  let scheduler = schedulers.get(qc);
  if (!scheduler) {
    scheduler = createInvalidationScheduler(qc);
    schedulers.set(qc, scheduler);
  }
  return scheduler;
}
