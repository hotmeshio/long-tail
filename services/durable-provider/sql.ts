/**
 * Waits for workflows on a non-HotMesh engine. Each wait owns one escalation
 * row in `public.hmsh_escalations`, created without a `signal_key` so the
 * store's resolve never composes a HotMesh wake for it.
 */

type TimeoutPayloadSql = typeof import('@hotmeshio/hotmesh/build/services/store/providers/postgres/escalation-accumulate').timeoutPayloadSql;

const WAIT_MATCH = 'x.provider = $1 AND x.workflow_id = $2 AND x.run_scope = $3 AND x.wait_key = $4';

/**
 * Open a wait and its escalation in one statement. A repeat returns the
 * existing row; when that row is terminal and was delivered, delivery is
 * cleared so the relay sends it again (the engine re-ran the wait).
 * `assignee` ($17) and `durationMinutes` ($18) write the claim columns as
 * HotMesh's insert does: an assignee alone pre-assigns; with a duration the
 * claim window is armed. A `signal_key` ($21) held by another wait raises a
 * unique violation on idx_lt_durable_waits_signal_key; one a HotMesh
 * escalation holds opens nothing. Delivery is cleared only for a caller
 * naming the row's role ($10).
 * Zero rows means the key is held by HotMesh, or a concurrent open won the
 * wait under this snapshot: retry.
 */
export const OPEN_WAIT = `
  WITH w AS (
    INSERT INTO lt_durable_waits (escalation_id, provider, workflow_id, run_scope, wait_key, workflow_type, signal_key)
    SELECT gen_random_uuid(), $1, $2, $3, $4, $5, $21
    WHERE $21::text IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.hmsh_escalations k
      WHERE k.namespace = $6 AND k.app_id = $6 AND k.signal_key = $21::text)
    ON CONFLICT (provider, workflow_id, run_scope, wait_key) DO NOTHING
    RETURNING escalation_id
  ), e AS (
    INSERT INTO public.hmsh_escalations
      (id, namespace, app_id, workflow_id, workflow_type, type, subtype, description, role,
       priority, metadata, escalation_payload, envelope, created_by, initiated_by, expires_at,
       origin_id, parent_id, assigned_to, assigned_until, claimed_at, claim_expires_at)
    SELECT w.escalation_id, $6, $6, $2, $5, $7, $8, $9, $10,
           $11, $12::jsonb, $13::jsonb, $16::jsonb, $14, $14, $15::timestamptz,
           $19, $20, $17::text,
           CASE WHEN $17::text IS NOT NULL AND $18::numeric IS NOT NULL
                THEN NOW() + ($18::numeric * INTERVAL '1 minute') END,
           CASE WHEN $17::text IS NOT NULL THEN NOW() END,
           CASE WHEN $17::text IS NOT NULL AND $18::numeric IS NOT NULL
                THEN NOW() + ($18::numeric * INTERVAL '1 minute') END
    FROM w
    RETURNING *
  ), reopened AS (
    UPDATE lt_durable_waits x
    SET delivered_at = NULL, delivery = NULL, next_attempt_at = NULL, last_error = NULL
    FROM public.hmsh_escalations h
    WHERE NOT EXISTS (SELECT 1 FROM w) AND ${WAIT_MATCH}
      AND h.id = x.escalation_id AND h.role = $10 AND h.status <> 'pending' AND x.delivered_at IS NOT NULL
    RETURNING x.escalation_id
  )
  SELECT e.*, true AS created, false AS reopened FROM e
  UNION ALL
  SELECT h.*, false AS created, EXISTS (SELECT 1 FROM reopened) AS reopened
  FROM lt_durable_waits x JOIN public.hmsh_escalations h ON h.id = x.escalation_id
  WHERE NOT EXISTS (SELECT 1 FROM w) AND ${WAIT_MATCH}`;

export const GET_WAIT_BY_ESCALATION = `
  SELECT * FROM lt_durable_waits WHERE escalation_id = $1`;

/**
 * Lease up to $2 undelivered waits whose escalation is terminal. The lease
 * keeps concurrent relays from delivering the same wait.
 */
export const CLAIM_DELIVERIES = `
  UPDATE lt_durable_waits w
  SET lease_until = NOW() + ($1 * INTERVAL '1 millisecond'), attempts = w.attempts + 1
  FROM public.hmsh_escalations e
  WHERE w.escalation_id = e.id
    AND w.escalation_id IN (
      SELECT x.escalation_id FROM lt_durable_waits x
      JOIN public.hmsh_escalations y ON y.id = x.escalation_id
      WHERE x.delivered_at IS NULL
        AND y.status IN ('resolved', 'cancelled', 'expired')
        AND (x.lease_until IS NULL OR x.lease_until < NOW())
        AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= NOW())
      ORDER BY y.updated_at
      LIMIT $2
      FOR UPDATE OF x SKIP LOCKED)
  RETURNING w.escalation_id, w.provider, w.workflow_id, w.workflow_type, w.run_scope, w.wait_key, w.attempts,
            e.status, e.resolver_payload, e.resolved_at, e.updated_at,
            COALESCE(e.metadata->>'resolved_by', e.assigned_to) AS resolved_by`;

/**
 * Extend the lease on a claimed wait before delivering it. `attempts` ($3)
 * is the claim's own count, so a wait claimed again elsewhere matches
 * nothing. Zero rows: skip the wait.
 */
export const RENEW_LEASE = `
  UPDATE lt_durable_waits
  SET lease_until = NOW() + ($2 * INTERVAL '1 millisecond')
  WHERE escalation_id = $1 AND attempts = $3 AND delivered_at IS NULL AND lease_until >= NOW()
  RETURNING escalation_id`;

const FOLLOW_UPSERT = `
  ON CONFLICT (provider, workflow_id) DO UPDATE
  SET next_check_at = EXCLUDED.next_check_at, checks = 0,
      workflow_type = COALESCE(EXCLUDED.workflow_type, lt_durable_follows.workflow_type)`;

/**
 * Record the delivery. With a first check delay ($3, milliseconds) the
 * workflow is followed in the same statement; null records the delivery alone.
 */
export const MARK_DELIVERED = `
  WITH d AS (
    UPDATE lt_durable_waits
    SET delivered_at = NOW(), delivery = $2, lease_until = NULL, last_error = NULL
    WHERE escalation_id = $1
    RETURNING provider, workflow_id, workflow_type)
  INSERT INTO lt_durable_follows (provider, workflow_id, workflow_type, next_check_at)
  SELECT d.provider, d.workflow_id, d.workflow_type, NOW() + ($3::bigint * INTERVAL '1 millisecond')
  FROM d WHERE $3::bigint IS NOT NULL${FOLLOW_UPSERT}`;

/** Follow a workflow, first checked after $4 milliseconds. A repeat restarts its checks. */
export const RECORD_FOLLOW = `
  INSERT INTO lt_durable_follows (provider, workflow_id, workflow_type, next_check_at)
  VALUES ($1, $2, NULLIF($3, ''), NOW() + ($4::bigint * INTERVAL '1 millisecond'))${FOLLOW_UPSERT}
  RETURNING (xmax = 0) AS created`;

/**
 * Take up to $2 due follows, moving each one's next check out by a doubling
 * delay ($3 base, $4 cap, milliseconds) so concurrent relays take different rows.
 */
export const CLAIM_DUE_FOLLOWS = `
  UPDATE lt_durable_follows f
  SET checks = f.checks + 1,
      next_check_at = NOW() + LEAST($3::float8 * POWER(2, LEAST(f.checks, 30)), $4::float8) * INTERVAL '1 millisecond'
  WHERE f.provider = $1 AND f.workflow_id IN (
    SELECT x.workflow_id FROM lt_durable_follows x
    WHERE x.provider = $1 AND x.next_check_at <= NOW()
    ORDER BY x.next_check_at
    LIMIT $2
    FOR UPDATE SKIP LOCKED)
  RETURNING f.workflow_id, f.workflow_type`;

/** Remove a follow. The caller that gets the row publishes the completion. */
export const REMOVE_FOLLOW = `
  DELETE FROM lt_durable_follows WHERE provider = $1 AND workflow_id = $2
  RETURNING workflow_type`;

export const MARK_RETRY = `
  UPDATE lt_durable_waits
  SET lease_until = NULL, last_error = $2, next_attempt_at = NOW() + ($3 * INTERVAL '1 millisecond')
  WHERE escalation_id = $1 AND attempts = $4 AND delivered_at IS NULL`;

/**
 * Expire pending provider escalations whose SLA has passed. An accumulator,
 * or a batch with `partialOnTimeout`, stores its collection as the resolver
 * payload, as HotMesh's expiry does, and the relay delivers it. Built on
 * first use, so only a provider deployment depends on the SDK module path.
 */
let expireDue: string | null = null;
export function expireDueSql(): string {
  if (!expireDue) {
    const { timeoutPayloadSql } = require('@hotmeshio/hotmesh/build/services/store/providers/postgres/escalation-accumulate') as { timeoutPayloadSql: TimeoutPayloadSql };
    expireDue = `
  UPDATE public.hmsh_escalations e
  SET status = 'expired', updated_at = NOW(), resolver_payload = ${timeoutPayloadSql('e')}
  FROM lt_durable_waits w
  WHERE w.escalation_id = e.id AND e.status = 'pending'
    AND e.expires_at IS NOT NULL AND e.expires_at <= NOW()
  RETURNING e.*`;
  }
  return expireDue;
}

/** Milliseconds until the earliest pending provider wait expires; null when none carries an expiry. */
export const NEXT_EXPIRY = `
  SELECT EXTRACT(EPOCH FROM (MIN(e.expires_at) - NOW())) * 1000 AS due_in_ms
  FROM lt_durable_waits w JOIN public.hmsh_escalations e ON e.id = w.escalation_id
  WHERE w.provider = $1 AND e.status = 'pending' AND e.expires_at IS NOT NULL`;

/** Runs with a pending provider escalation, after a keyset cursor. */
export const PENDING_RUNS = `
  SELECT DISTINCT w.workflow_id, w.run_scope
  FROM lt_durable_waits w JOIN public.hmsh_escalations e ON e.id = w.escalation_id
  WHERE w.provider = $1 AND e.status = 'pending' AND (w.workflow_id, w.run_scope) > ($2, $3)
  ORDER BY w.workflow_id, w.run_scope
  LIMIT $4`;

/** Cancel the pending escalations of one run's waits. */
export const CANCEL_RUN_WAITS = `
  UPDATE public.hmsh_escalations e
  SET status = 'cancelled', updated_at = NOW()
  FROM lt_durable_waits w
  WHERE w.escalation_id = e.id AND w.provider = $1 AND w.workflow_id = $2 AND w.run_scope = $3
    AND e.status = 'pending'
  RETURNING e.*`;

/** Waits whose escalation row has been pruned. */
export const PRUNE_ORPHANED_WAITS = `
  DELETE FROM lt_durable_waits w
  WHERE NOT EXISTS (SELECT 1 FROM public.hmsh_escalations e WHERE e.id = w.escalation_id)`;

export const SIGNAL_KEY_INDEX = 'idx_lt_durable_waits_signal_key';

export const WAIT_BY_SIGNAL_KEY = `
  SELECT escalation_id FROM lt_durable_waits WHERE signal_key = $1`;
