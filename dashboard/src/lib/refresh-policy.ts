import type { QueryClient } from '@tanstack/react-query';

/** The pacing of one refresh lane. */
export interface TierPolicy {
  /** A burst of events lands as one flush after this long. */
  coalesceMs: number;
  /** Least time between two flushes of the lane. */
  minIntervalMs: number;
}

/** How events turn into refetches, as the deployment configures it. */
export interface RefreshPolicy {
  /** When false, events mark queries stale and fetch nothing. */
  enabled: boolean;
  /** Whether returning focus to the window refetches stale queries. */
  refetchOnFocus: boolean;
  DETAIL: TierPolicy;
  LIST: TierPolicy;
  SUMMARY: TierPolicy;
}

export const DEFAULT_REFRESH_POLICY: RefreshPolicy = {
  enabled: true,
  refetchOnFocus: false,
  DETAIL: { coalesceMs: 300, minIntervalMs: 2_000 },
  LIST: { coalesceMs: 500, minIntervalMs: 10_000 },
  SUMMARY: { coalesceMs: 1_000, minIntervalMs: 10_000 },
};

interface RawTierPolicy {
  coalesceMs?: unknown;
  minIntervalMs?: unknown;
}

export interface RawRefreshPolicy {
  enabled?: unknown;
  refetchOnFocus?: unknown;
  detail?: RawTierPolicy;
  list?: RawTierPolicy;
  summary?: RawTierPolicy;
}

const pickMs = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const pickFlag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

function resolveTier(raw: RawTierPolicy | undefined, fallback: TierPolicy): TierPolicy {
  return {
    coalesceMs: pickMs(raw?.coalesceMs, fallback.coalesceMs),
    minIntervalMs: pickMs(raw?.minIntervalMs, fallback.minIntervalMs),
  };
}

/** The server's refresh settings, with defaults for anything missing or invalid. */
export function resolveRefreshPolicy(raw: RawRefreshPolicy | null | undefined): RefreshPolicy {
  return {
    enabled: pickFlag(raw?.enabled, DEFAULT_REFRESH_POLICY.enabled),
    refetchOnFocus: pickFlag(raw?.refetchOnFocus, DEFAULT_REFRESH_POLICY.refetchOnFocus),
    DETAIL: resolveTier(raw?.detail, DEFAULT_REFRESH_POLICY.DETAIL),
    LIST: resolveTier(raw?.list, DEFAULT_REFRESH_POLICY.LIST),
    SUMMARY: resolveTier(raw?.summary, DEFAULT_REFRESH_POLICY.SUMMARY),
  };
}

let current: RefreshPolicy = DEFAULT_REFRESH_POLICY;

/** The policy in force. The scheduler reads it each time it schedules a flush. */
export function getRefreshPolicy(): RefreshPolicy {
  return current;
}

export function setRefreshPolicy(policy: RefreshPolicy): void {
  current = policy;
}

/** Put a policy in force: the scheduler reads it, and the client's focus refetch follows it. */
export function applyRefreshPolicy(qc: QueryClient, policy: RefreshPolicy): void {
  setRefreshPolicy(policy);
  const defaults = qc.getDefaultOptions();
  qc.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, refetchOnWindowFocus: policy.refetchOnFocus },
  });
}
