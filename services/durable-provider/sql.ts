/**
 * Waits for workflows on a non-HotMesh engine. Each wait owns one escalation
 * row in `public.hmsh_escalations`, created without a `signal_key` so the
 * store's resolve never composes a HotMesh wake for it.
 */

const WAIT_MATCH = 'x.provider = $1 AND x.workflow_id = $2 AND x.run_scope = $3 AND x.wait_key = $4';

/**
 * Open a wait and its escalation in one statement. A repeat returns the
 * existing row; when that row is terminal and was delivered, delivery is
 * cleared so the relay sends it again (the engine re-ran the wait).
 * Zero rows means a concurrent open won the key under this snapshot: retry.
 */
export const OPEN_WAIT = `
  WITH w AS (
    INSERT INTO lt_durable_waits (escalation_id, provider, workflow_id, run_scope, wait_key, workflow_type)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
    ON CONFLICT (provider, workflow_id, run_scope, wait_key) DO NOTHING
    RETURNING escalation_id
  ), e AS (
    INSERT INTO public.hmsh_escalations
      (id, namespace, app_id, workflow_id, workflow_type, type, subtype, description, role,
       priority, metadata, escalation_payload, envelope, created_by, initiated_by, expires_at)
    SELECT w.escalation_id, $6, $6, $2, $5, $7, $8, $9, $10,
           $11, $12::jsonb, $13::jsonb, '{}'::jsonb, $14, $14, $15::timestamptz
    FROM w
    RETURNING *
  ), reopened AS (
    UPDATE lt_durable_waits x
    SET delivered_at = NULL, delivery = NULL, next_attempt_at = NULL, last_error = NULL
    FROM public.hmsh_escalations h
    WHERE NOT EXISTS (SELECT 1 FROM w) AND ${WAIT_MATCH}
      AND h.id = x.escalation_id AND h.status <> 'pending' AND x.delivered_at IS NOT NULL
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

export const MARK_DELIVERED = `
  UPDATE lt_durable_waits
  SET delivered_at = NOW(), delivery = $2, lease_until = NULL, last_error = NULL
  WHERE escalation_id = $1`;

export const MARK_RETRY = `
  UPDATE lt_durable_waits
  SET lease_until = NULL, last_error = $2, next_attempt_at = NOW() + ($3 * INTERVAL '1 millisecond')
  WHERE escalation_id = $1`;

/** Expire pending provider escalations whose SLA has passed. */
export const EXPIRE_DUE = `
  UPDATE public.hmsh_escalations e
  SET status = 'expired', updated_at = NOW()
  FROM lt_durable_waits w
  WHERE w.escalation_id = e.id AND e.status = 'pending'
    AND e.expires_at IS NOT NULL AND e.expires_at <= NOW()
  RETURNING e.*`;

/** Workflows with a pending provider escalation, after a keyset cursor. */
export const PENDING_WORKFLOWS = `
  SELECT DISTINCT w.workflow_id
  FROM lt_durable_waits w JOIN public.hmsh_escalations e ON e.id = w.escalation_id
  WHERE w.provider = $1 AND e.status = 'pending' AND w.workflow_id > $2
  ORDER BY w.workflow_id
  LIMIT $3`;

/** Delivered waits whose escalation row has been pruned. */
export const PRUNE_ORPHANED_WAITS = `
  DELETE FROM lt_durable_waits w
  WHERE w.delivered_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.hmsh_escalations e WHERE e.id = w.escalation_id)`;
