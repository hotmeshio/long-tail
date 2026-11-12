export const DURABLE_LOG = {
  REGISTERED: 'durable_provider.registered',
  WAIT_OPENED: 'durable_provider.wait.opened',
  WAIT_REOPENED: 'durable_provider.wait.reopened',
  RELAY_DELIVERED: 'durable_provider.relay.delivered',
  RELAY_GONE: 'durable_provider.relay.gone',
  RELAY_RETRY: 'durable_provider.relay.retry',
  RELAY_FAILED: 'durable_provider.relay.failed',
  WAITS_EXPIRED: 'durable_provider.waits.expired',
  WAITS_RECONCILED: 'durable_provider.waits.reconciled',
  FOLLOW_SKIPPED: 'durable_provider.follow.skipped',
  FOLLOW_FAILED: 'durable_provider.follow.failed',
} as const;

export const RELAY_DEFAULTS = {
  SWEEP_MS: 30_000,
  LEASE_MS: 30_000,
  BATCH: 50,
  RECONCILE_MS: 15 * 60_000,
  BACKOFF_BASE_MS: 1_000,
  BACKOFF_MAX_MS: 5 * 60_000,
  KICK_DEBOUNCE_MS: 50,
} as const;

/** After a delivery, describe checks at these delays (about 25 s in all), until the workflow closes. */
export const FOLLOW_DEFAULTS = {
  DELAYS_MS: [100, 200, 400, 800, 1_600, 3_200, 6_400, 12_800],
  MAX_FOLLOWED: 1_000,
} as const;

/** Namespace and app id the escalation store uses for rows Long Tail creates. */
export const ESCALATION_STORE_NAMESPACE = 'hmsh';

/** Cancel reason recorded when a workflow ended while its escalation was pending. */
export const RECONCILE_CANCEL_REASON = 'workflow-closed';

/** Field limits for `POST /api/escalations/waits`. */
export const WAIT_LIMITS = {
  KEY_MAX: 255,
  WORKFLOW_ID_MAX: 1000,
} as const;
