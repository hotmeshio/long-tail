// ---------------------------------------------------------------------------
// Single-flight, short-TTL in-process cache.
//
// Memoizes the expensive half of the station-metrics query (percentile /
// throughput aggregates) so a burst of socket-driven dashboard refreshes and
// all concurrent viewers collapse to one computation per TTL window. Live
// counts are never cached — only slow-changing historical aggregates, which
// tolerate 30-60s staleness.
//
// Per-container by design: the values are read-only aggregates and cross-
// container drift within the TTL is acceptable. No cross-node coordination.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  at: number;
  value: Promise<T>;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  /**
   * Return the cached value for `key` when it is younger than the TTL. On a
   * miss, run `compute`, cache the in-flight promise so concurrent callers
   * share one computation (no thundering herd), and return it. A rejected
   * computation is evicted so the next caller retries rather than caching the
   * failure.
   */
  async resolve(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const value = compute();
    this.store.set(key, { at: Date.now(), value });
    try {
      return await value;
    } catch (err) {
      this.store.delete(key);
      throw err;
    }
  }

  clear(): void {
    this.store.clear();
  }
}
