// ---------------------------------------------------------------------------
// Escalation SQL
//
// The escalation service operates through `client.escalations.*` over
// `public.hmsh_escalations`. The single exception is the resolve-by-metadata
// signal guard: long-tail must NOT resolve a signal-backed row in the DB (it
// signals the paused workflow instead, and the workflow interceptor resolves
// durably). That decision plus the find + claim + resolve must be one atomic
// statement to avoid a TOCTOU window, so it is expressed directly against
// `hmsh_escalations` here rather than composed from generic SDK calls.
// ---------------------------------------------------------------------------

/**
 * Sweep expired claims back to the available pool.
 *
 * In the implicit-claim model an expired claim is already available at query
 * time (`assigned_until <= NOW()`), so this is a cosmetic cleanup — but it is
 * long-tail's public contract (returns a count, clears `assigned_to`) and the
 * SDK's `releaseExpired()` is a no-op, so it runs as direct SQL on the shared
 * table. Clears both `assigned_until` and `claim_expires_at`.
 */
export const RELEASE_EXPIRED_CLAIMS = `\
UPDATE public.hmsh_escalations
SET assigned_to = NULL,
    assigned_until = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    updated_at = NOW()
WHERE status = 'pending'
  AND assigned_to IS NOT NULL
  AND assigned_until <= NOW()`;

/**
 * Atomic resolve by metadata with signal guard.
 *
 * Single query, four outcomes:
 * 1. No signal backing → claim + resolve atomically. `resolved` is populated.
 * 2. `metadata.signal_id` present, row unclaimed → claim the row (preventing concurrent
 *    duplicate signals via FOR UPDATE serialization), then return signal info so the
 *    caller can signal the workflow. `signal_already_claimed = false`.
 * 3. `metadata.signal_id` present, row already claimed and claim not expired →
 *    a concurrent caller is handling the signal. `signal_already_claimed = true`;
 *    caller returns 409 without re-signaling.
 * 4. `signal_key` present (atomic conditionLT) → `claimed` and `resolved` both skip.
 *    Caller invokes SDK resolve to atomically mark resolved + deliver the signal.
 *
 * Signal_id hardening: the `claimed` CTE runs for signal_id rows (previously excluded).
 * This stamps `assigned_to` on the row inside the FOR UPDATE transaction, so a
 * concurrent second caller sees `signal_already_claimed = true` and aborts.
 * The `resolved` CTE still skips signal_id rows — the workflow resolves durably.
 *
 * $1 = metadata filter (jsonb), $2 = userId, $3 = resolver_payload (jsonb),
 * $4 = metadata patch (jsonb, nullable), $5 = allowed roles (text[], null = no filter)
 */
export const RESOLVE_BY_METADATA_ATOMIC = `\
WITH target AS MATERIALIZED (
  SELECT *
  FROM public.hmsh_escalations
  WHERE metadata @> $1::jsonb
    AND status = 'pending'
    AND ($5::text[] IS NULL OR role = ANY($5))
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE
),
claimed AS (
  UPDATE public.hmsh_escalations e
  SET assigned_to = COALESCE(e.assigned_to, $2),
      claimed_at = COALESCE(e.claimed_at, NOW()),
      assigned_until = CASE
        WHEN e.assigned_to IS NOT NULL AND e.assigned_until > NOW() THEN e.assigned_until
        ELSE NOW() + INTERVAL '5 minutes' END,
      claim_expires_at = CASE
        WHEN e.assigned_to IS NOT NULL AND e.assigned_until > NOW() THEN e.claim_expires_at
        ELSE NOW() + INTERVAL '5 minutes' END,
      metadata = CASE WHEN $4::jsonb IS NOT NULL
        THEN COALESCE(e.metadata, '{}'::jsonb) || $4::jsonb
        ELSE e.metadata END,
      updated_at = NOW()
  FROM target
  WHERE e.id = target.id
    AND target.signal_key IS NULL
  RETURNING e.*
),
resolved AS (
  UPDATE public.hmsh_escalations e
  SET status = 'resolved',
      resolved_at = NOW(),
      resolver_payload = $3,
      updated_at = NOW()
  FROM claimed
  WHERE e.id = claimed.id
    AND (claimed.metadata->>'signal_id') IS NULL
  RETURNING e.*
)
SELECT
  resolved.*,
  target.id AS target_id,
  target.metadata->>'signal_id' AS signal_id,
  target.signal_key AS signal_key,
  target.workflow_id AS target_workflow_id,
  target.workflow_type AS target_workflow_type,
  target.task_queue AS target_task_queue,
  (target.assigned_to IS NOT NULL
    AND target.assigned_until IS NOT NULL
    AND target.assigned_until > NOW()) AS signal_already_claimed,
  CASE WHEN resolved.id IS NOT NULL THEN 'resolved' ELSE 'signal_required' END AS outcome
FROM target
LEFT JOIN resolved ON resolved.id = target.id`;
