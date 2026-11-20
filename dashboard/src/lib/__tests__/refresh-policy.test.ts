import { describe, it, expect, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  DEFAULT_REFRESH_POLICY,
  applyRefreshPolicy,
  getRefreshPolicy,
  resolveRefreshPolicy,
  setRefreshPolicy,
} from '../refresh-policy';

afterEach(() => setRefreshPolicy(DEFAULT_REFRESH_POLICY));

describe('resolveRefreshPolicy', () => {
  it('returns the defaults for missing settings', () => {
    expect(resolveRefreshPolicy(null)).toEqual(DEFAULT_REFRESH_POLICY);
    expect(resolveRefreshPolicy({})).toEqual(DEFAULT_REFRESH_POLICY);
  });

  it('takes valid values and ignores invalid ones', () => {
    const policy = resolveRefreshPolicy({
      enabled: false,
      refetchOnFocus: true,
      list: { coalesceMs: 750, minIntervalMs: -1 },
      summary: { coalesceMs: 'soon', minIntervalMs: 30_000 },
    });
    expect(policy.enabled).toBe(false);
    expect(policy.refetchOnFocus).toBe(true);
    expect(policy.LIST).toEqual({ coalesceMs: 750, minIntervalMs: DEFAULT_REFRESH_POLICY.LIST.minIntervalMs });
    expect(policy.SUMMARY).toEqual({ coalesceMs: DEFAULT_REFRESH_POLICY.SUMMARY.coalesceMs, minIntervalMs: 30_000 });
    expect(policy.DETAIL).toEqual(DEFAULT_REFRESH_POLICY.DETAIL);
  });

  it('ignores non-boolean flags', () => {
    expect(resolveRefreshPolicy({ enabled: 'false', refetchOnFocus: 1 })).toMatchObject({
      enabled: true,
      refetchOnFocus: false,
    });
  });
});

describe('applyRefreshPolicy', () => {
  it('puts the policy in force and sets the focus refetch default', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
    const policy = resolveRefreshPolicy({ refetchOnFocus: true });
    applyRefreshPolicy(qc, policy);
    expect(getRefreshPolicy()).toBe(policy);
    expect(qc.getDefaultOptions().queries).toMatchObject({ staleTime: 10_000, refetchOnWindowFocus: true });
  });
});
