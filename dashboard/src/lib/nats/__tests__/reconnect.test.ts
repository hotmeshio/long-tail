import { describe, it, expect } from 'vitest';

import { DEFAULT_RECONNECT_POLICY, reconnectDelay, resolveReconnectPolicy, spreadDelay } from '../reconnect';

const policy = { initialDelayMs: 1_000, maxDelayMs: 60_000, noticeAfterMs: 30_000, spreadMs: 5_000 };

describe('reconnectDelay', () => {
  it('doubles from the initial delay', () => {
    const top = () => 1;
    expect([0, 1, 2, 3].map((n) => reconnectDelay(n, policy, top))).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('caps at the maximum delay', () => {
    expect(reconnectDelay(20, policy, () => 1)).toBe(60_000);
    expect(reconnectDelay(1_000, policy, () => 1)).toBe(60_000);
  });

  it('jitters between half and all of the delay', () => {
    expect(reconnectDelay(3, policy, () => 0)).toBe(4_000);
    expect(reconnectDelay(3, policy, () => 0.5)).toBe(6_000);
    for (let i = 0; i < 50; i++) {
      const delay = reconnectDelay(3, policy);
      expect(delay).toBeGreaterThanOrEqual(4_000);
      expect(delay).toBeLessThanOrEqual(8_000);
    }
  });
});

describe('spreadDelay', () => {
  it('lands anywhere across the spread window', () => {
    expect(spreadDelay(policy, () => 0)).toBe(0);
    expect(spreadDelay(policy, () => 0.5)).toBe(2_500);
    expect(spreadDelay(policy, () => 1)).toBe(5_000);
  });
});

describe('resolveReconnectPolicy', () => {
  it('uses the server values', () => {
    expect(resolveReconnectPolicy({ initialDelayMs: 500, maxDelayMs: 10_000, noticeAfterMs: 5_000, spreadMs: 2_000 }))
      .toEqual({ initialDelayMs: 500, maxDelayMs: 10_000, noticeAfterMs: 5_000, spreadMs: 2_000 });
  });

  it('defaults missing or invalid values', () => {
    expect(resolveReconnectPolicy(null)).toEqual(DEFAULT_RECONNECT_POLICY);
    expect(resolveReconnectPolicy({ initialDelayMs: -1, maxDelayMs: Number.NaN }))
      .toEqual(DEFAULT_RECONNECT_POLICY);
  });
});
