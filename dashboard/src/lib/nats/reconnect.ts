/** How the dashboard paces NATS connection attempts and when it tells the user. */
export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  /** How long realtime stays down before the banner says so. */
  noticeAfterMs: number;
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  noticeAfterMs: 30_000,
};

/**
 * The wait before attempt `attempt` (0-based): doubling from the initial
 * delay up to the cap, then a random point between half and all of it so
 * tabs reconnecting after the same outage spread out.
 */
export function reconnectDelay(
  attempt: number,
  policy: ReconnectPolicy,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/** The server's reconnect settings, with defaults for anything missing or invalid. */
export function resolveReconnectPolicy(raw: Partial<ReconnectPolicy> | null | undefined): ReconnectPolicy {
  const pick = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    initialDelayMs: pick(raw?.initialDelayMs, DEFAULT_RECONNECT_POLICY.initialDelayMs),
    maxDelayMs: pick(raw?.maxDelayMs, DEFAULT_RECONNECT_POLICY.maxDelayMs),
    noticeAfterMs: pick(raw?.noticeAfterMs, DEFAULT_RECONNECT_POLICY.noticeAfterMs),
  };
}
