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
 *   - A query that is already fetching is never stacked on: its refresh waits
 *     for the lane's next window, so a slow backend slows the cadence instead
 *     of multiplying requests.
 *   - An event whose query was fetched after the event arrived is already
 *     reflected in that fetch (a mutation's own refresh, a navigation), so
 *     the flush skips it.
 *   - A HIDDEN tab never refetches: flushes mark queries stale without
 *     network (refetchType 'none'), and one catch-up refetch runs when the
 *     tab becomes visible again.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { DEFAULT_REFRESH_POLICY, getRefreshPolicy } from './refresh-policy';

/**
 * The default per-tier discipline. A deployment overrides it through
 * `/api/settings` (see refresh-policy.ts); the scheduler reads the policy in
 * force each time it schedules.
 *
 *   DETAIL: one record's page, the snappiest surface.
 *   LIST: queues and job lists.
 *   SUMMARY: aggregates such as pace board metrics, counts and analytics.
 */
export const REALTIME_REFRESH = {
  DETAIL: DEFAULT_REFRESH_POLICY.DETAIL,
  LIST: DEFAULT_REFRESH_POLICY.LIST,
  SUMMARY: DEFAULT_REFRESH_POLICY.SUMMARY,
} as const;

export type RefreshTier = keyof typeof REALTIME_REFRESH;

/** The input-debounce twin (search boxes, find-as-you-type), centralized. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Snappiest first — a key requested by two tiers flushes on the snappier lane. */
const TIER_RANK: Record<RefreshTier, number> = { DETAIL: 0, LIST: 1, SUMMARY: 2 };

export interface InvalidationScheduler {
  /** Queue query keys for a tier-bounded batch invalidation. */
  request(tier: RefreshTier, keys: ReadonlyArray<QueryKey>): void;
  /** Detach timers and the visibility listener (tests). */
  dispose(): void;
}

function createInvalidationScheduler(qc: QueryClient): InvalidationScheduler {
  // One pending map across every hook: serialized key → the snappiest tier
  // that asked for it. Flushing a lane takes only its own keys.
  const pending = new Map<string, RefreshTier>();
  // Serialized key → when the latest event for it arrived.
  const requestedAt = new Map<string, number>();
  // Query hash → when its latest fetch began. A fetch that began after an
  // event arrived read the state the event announced.
  const fetchStartedAt = new Map<string, number>();
  const stopWatching = qc.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'fetch') {
      fetchStartedAt.set(event.query.queryHash, Date.now());
    }
  });
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
    const stillNeeded = batch.filter((raw) => !fetchedSinceEvent(raw));
    for (const raw of batch) {
      if (fetchedSinceEvent(raw)) requestedAt.delete(raw);
    }

    // Hidden tabs mark stale without network; the catch-up runs on return.
    // A disabled policy marks stale the same way and never fetches.
    const markOnly = isHidden() || !getRefreshPolicy().enabled;
    if (isHidden()) staleWhileHidden = true;
    for (const raw of stillNeeded) {
      const queryKey = JSON.parse(raw);
      if (!markOnly && isFetching(queryKey)) {
        pending.set(raw, tier);
        continue;
      }
      requestedAt.delete(raw);
      qc.invalidateQueries(
        { queryKey, ...(markOnly ? { refetchType: 'none' as const } : {}) },
        { cancelRefetch: false },
      );
    }
    if (pending.size > 0 && [...pending.values()].includes(tier)) schedule(tier);
  }

  function fetchedSinceEvent(raw: string): boolean {
    const arrived = requestedAt.get(raw);
    const query = qc.getQueryCache().find({ queryKey: JSON.parse(raw), exact: true });
    const started = query ? fetchStartedAt.get(query.queryHash) : undefined;
    return arrived !== undefined && started !== undefined && started > arrived;
  }

  function isFetching(queryKey: QueryKey): boolean {
    return qc.getQueryCache().find({ queryKey, exact: true })?.state.fetchStatus === 'fetching';
  }

  function schedule(tier: RefreshTier): void {
    if (timers[tier]) return; // a flush is already on the way for this lane
    const { coalesceMs, minIntervalMs } = getRefreshPolicy()[tier];
    const last = lastFlushAt[tier];
    const cooldownRemaining = last === undefined ? 0 : last + minIntervalMs - Date.now();
    const delay = Math.max(coalesceMs, cooldownRemaining);
    timers[tier] = setTimeout(() => flush(tier), delay);
  }

  function request(tier: RefreshTier, keys: ReadonlyArray<QueryKey>): void {
    for (const key of keys) {
      const raw = JSON.stringify(key);
      requestedAt.set(raw, Date.now());
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
      requestedAt.clear();
      fetchStartedAt.clear();
      stopWatching();
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
