import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache, BoundedTtlCache } from '../../../services/escalation/metrics-cache';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TtlCache', () => {
  it('single-flight: concurrent callers share one computation', async () => {
    const cache = new TtlCache<number>(1000);
    const compute = vi.fn().mockResolvedValue(42);
    const [a, b] = await Promise.all([cache.resolve('k', compute), cache.resolve('k', compute)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes after the TTL and evicts rejected computations', async () => {
    const cache = new TtlCache<number>(1000);
    const compute = vi.fn().mockResolvedValue(1);
    await cache.resolve('k', compute);
    vi.advanceTimersByTime(1001);
    await cache.resolve('k', compute);
    expect(compute).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(2);
    await expect(cache.resolve('f', failing)).rejects.toThrow('boom');
    await expect(cache.resolve('f', failing)).resolves.toBe(2);
  });
});

describe('BoundedTtlCache', () => {
  it('evicts the least-recently-used entry once maxEntries is reached', async () => {
    const cache = new BoundedTtlCache<string>(60_000, 2);
    const compute = (v: string) => vi.fn().mockResolvedValue(v);
    const a = compute('a');
    await cache.resolve('a', a);
    await cache.resolve('b', compute('b'));
    await cache.resolve('a', a); // refresh recency: 'b' is now LRU
    await cache.resolve('c', compute('c')); // evicts 'b'

    const b2 = compute('b2');
    await expect(cache.resolve('b', b2)).resolves.toBe('b2'); // recomputed
    expect(b2).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1); // 'a' survived the eviction
  });

  it('shares in-flight computations and evicts rejections like TtlCache', async () => {
    const cache = new BoundedTtlCache<number>(60_000, 8);
    const compute = vi.fn().mockResolvedValue(7);
    const [x, y] = await Promise.all([cache.resolve('k', compute), cache.resolve('k', compute)]);
    expect(x + y).toBe(14);
    expect(compute).toHaveBeenCalledTimes(1);

    const failing = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValue(9);
    await expect(cache.resolve('f', failing)).rejects.toThrow('nope');
    await expect(cache.resolve('f', failing)).resolves.toBe(9);
  });

  it('expires entries by TTL and clear() drops everything', async () => {
    const cache = new BoundedTtlCache<number>(1000, 8);
    const compute = vi.fn().mockResolvedValue(1);
    await cache.resolve('k', compute);
    vi.advanceTimersByTime(1001);
    await cache.resolve('k', compute);
    expect(compute).toHaveBeenCalledTimes(2);

    cache.clear();
    await cache.resolve('k', compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });
});
