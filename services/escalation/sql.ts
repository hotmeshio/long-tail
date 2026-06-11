// ---------------------------------------------------------------------------
// Escalation SQL – externalized from crud.ts, bulk.ts, queries.ts
// ---------------------------------------------------------------------------

// --- Role management -------------------------------------------------------

export const ENSURE_ROLE_EXISTS =
  'INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING';

// --- Single-record CRUD ---------------------------------------------------

export const CREATE_ESCALATION = `\
INSERT INTO lt_escalations
  (type, subtype, description, priority, task_id,
   origin_id, parent_id, role, envelope, metadata, escalation_payload,
   workflow_id, task_queue, workflow_type, trace_id, span_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING *`;

export const CLAIM_ESCALATION = `\
WITH prev AS (
  SELECT assigned_to, assigned_until
  FROM lt_escalations
  WHERE id = $1
),
updated AS (
  UPDATE lt_escalations
  SET assigned_to = $2,
      claimed_at = NOW(),
      assigned_until = NOW() + INTERVAL '1 minute' * $3
  WHERE id = $1
    AND status = 'pending'
    AND (
      assigned_to IS NULL
      OR assigned_until <= NOW()
      OR assigned_to = $2
    )
  RETURNING *
)
SELECT updated.*,
       prev.assigned_to AS prev_assigned_to
FROM updated
CROSS JOIN prev`;

export const RESOLVE_ESCALATION = `\
UPDATE lt_escalations
SET status = 'resolved',
    resolved_at = NOW(),
    resolver_payload = $2
WHERE id = $1
  AND status = 'pending'
RETURNING *`;

export const UPDATE_ESCALATIONS_PRIORITY = `\
UPDATE lt_escalations
SET priority = $1, updated_at = NOW()
WHERE id = ANY($2::uuid[])
  AND status = 'pending'`;

export const GET_ESCALATION_ROLES =
  'SELECT DISTINCT role FROM lt_escalations WHERE id = ANY($1::uuid[])';

export const RELEASE_ESCALATION = `\
UPDATE lt_escalations
SET assigned_to = NULL,
    assigned_until = NULL,
    claimed_at = NULL
WHERE id = $1
  AND status = 'pending'
  AND assigned_to = $2
RETURNING *`;

export const RELEASE_EXPIRED_CLAIMS = `\
UPDATE lt_escalations
SET assigned_to = NULL,
    assigned_until = NULL,
    claimed_at = NULL
WHERE status = 'pending'
  AND assigned_to IS NOT NULL
  AND assigned_until < NOW()`;

export const ESCALATE_TO_ROLE = `\
UPDATE lt_escalations
SET role = $2,
    assigned_to = NULL,
    assigned_until = NULL,
    claimed_at = NULL,
    updated_at = NOW()
WHERE id = $1
  AND status = 'pending'
RETURNING *`;

export const GET_ESCALATION =
  'SELECT * FROM lt_escalations WHERE id = $1';

export const GET_ESCALATIONS_BY_TASK_ID =
  'SELECT * FROM lt_escalations WHERE task_id = $1 ORDER BY created_at DESC';

export const GET_ESCALATIONS_BY_WORKFLOW_ID =
  'SELECT * FROM lt_escalations WHERE workflow_id = $1 ORDER BY created_at DESC';

export const GET_ESCALATIONS_BY_ORIGIN_ID =
  'SELECT * FROM lt_escalations WHERE origin_id = $1 ORDER BY created_at DESC';

// --- Bulk operations -------------------------------------------------------

/** Used by both bulkClaimEscalations and bulkAssignEscalations (identical SQL). */
export const BULK_CLAIM = `\
UPDATE lt_escalations
SET assigned_to = $1,
    claimed_at = NOW(),
    assigned_until = NOW() + INTERVAL '1 minute' * $2
WHERE id = ANY($3::uuid[])
  AND status = 'pending'
  AND (
    assigned_to IS NULL
    OR assigned_until <= NOW()
    OR assigned_to = $1
  )`;

export const BULK_ASSIGN = BULK_CLAIM;

export const BULK_ESCALATE_TO_ROLE = `\
UPDATE lt_escalations
SET role = $1,
    assigned_to = NULL,
    assigned_until = NULL,
    claimed_at = NULL,
    updated_at = NOW()
WHERE id = ANY($2::uuid[])
  AND status = 'pending'`;

export const BULK_RESOLVE_FOR_TRIAGE = `\
UPDATE lt_escalations
SET status = 'resolved',
    resolved_at = NOW(),
    resolver_payload = $1
WHERE id = ANY($2::uuid[])
  AND status = 'pending'
RETURNING *`;

// --- Query helpers ---------------------------------------------------------

export const UPDATE_ESCALATION_METADATA = `\
UPDATE lt_escalations
SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
    updated_at = NOW()
WHERE id = $1
RETURNING *`;

export const ENRICH_ESCALATION_ROUTING = `\
UPDATE lt_escalations
SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
    workflow_type = COALESCE(workflow_type, $3),
    workflow_id = COALESCE(workflow_id, $4),
    task_queue = COALESCE(task_queue, $5),
    task_id = COALESCE(task_id, $6),
    updated_at = NOW()
WHERE id = $1
RETURNING *`;

export const LIST_DISTINCT_TYPES =
  'SELECT DISTINCT type FROM lt_escalations ORDER BY type';

// --- Metadata candidate key lookups -----------------------------------------

/** Find escalations by a single metadata key-value pair. Window function for total count. */
export const FIND_BY_METADATA = `\
SELECT *, COUNT(*) OVER() AS _total
FROM lt_escalations
WHERE metadata @> $1::jsonb
  AND ($2::text IS NULL OR status = $2)
ORDER BY priority ASC, created_at ASC
LIMIT $3 OFFSET $4`;

/**
 * Atomic claim by metadata with inline RBAC.
 * $1 = metadata filter (jsonb), $2 = userId, $3 = durationMinutes,
 * $4 = metadata patch (jsonb, nullable), $5 = allowed roles (text[], null = no filter)
 */
export const CLAIM_BY_METADATA_GUARDED = `\
WITH target AS MATERIALIZED (
  SELECT id, assigned_to
  FROM lt_escalations
  WHERE metadata @> $1::jsonb
    AND status = 'pending'
    AND (assigned_to IS NULL OR assigned_until <= NOW() OR assigned_to = $2)
    AND ($5::text[] IS NULL OR role = ANY($5))
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
),
updated AS (
  UPDATE lt_escalations e
  SET assigned_to = $2,
      claimed_at = NOW(),
      assigned_until = NOW() + INTERVAL '1 minute' * $3,
      metadata = CASE WHEN $4::jsonb IS NOT NULL
        THEN COALESCE(e.metadata, '{}'::jsonb) || $4::jsonb
        ELSE e.metadata END,
      updated_at = NOW()
  FROM target t
  WHERE e.id = t.id
  RETURNING e.*, t.assigned_to AS prev_assigned_to
)
SELECT *,
  (SELECT COUNT(*) FROM lt_escalations WHERE metadata @> $1::jsonb AND status = 'pending') AS candidates_exist
FROM updated`;

/**
 * Atomic resolve by metadata with signal guard.
 *
 * Single query, two outcomes:
 * 1. No signal_id → claim + resolve atomically. `resolved` is populated.
 * 2. signal_id present → resolve CTE skips (guard in WHERE). `resolved` is null,
 *    but `target_id`, `signal_id`, `workflow_id`, `task_queue`, `workflow_type`
 *    are returned so the caller can signal the workflow directly.
 *
 * $1 = metadata filter (jsonb), $2 = userId, $3 = resolver_payload (jsonb),
 * $4 = metadata patch (jsonb, nullable), $5 = allowed roles (text[], null = no filter)
 */
export const RESOLVE_BY_METADATA_ATOMIC = `\
WITH target AS MATERIALIZED (
  SELECT *
  FROM lt_escalations
  WHERE metadata @> $1::jsonb
    AND status = 'pending'
    AND ($5::text[] IS NULL OR role = ANY($5))
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE
),
claimed AS (
  UPDATE lt_escalations e
  SET assigned_to = COALESCE(e.assigned_to, $2),
      claimed_at = COALESCE(e.claimed_at, NOW()),
      assigned_until = CASE
        WHEN e.assigned_to IS NOT NULL AND e.assigned_until > NOW() THEN e.assigned_until
        ELSE NOW() + INTERVAL '5 minutes' END,
      metadata = CASE WHEN $4::jsonb IS NOT NULL
        THEN COALESCE(e.metadata, '{}'::jsonb) || $4::jsonb
        ELSE e.metadata END
  FROM target
  WHERE e.id = target.id
    AND (target.metadata->>'signal_id') IS NULL
  RETURNING e.*
),
resolved AS (
  UPDATE lt_escalations e
  SET status = 'resolved',
      resolved_at = NOW(),
      resolver_payload = $3,
      updated_at = NOW()
  FROM claimed
  WHERE e.id = claimed.id
  RETURNING e.*
)
SELECT
  resolved.*,
  target.id AS target_id,
  target.metadata->>'signal_id' AS signal_id,
  target.workflow_id AS target_workflow_id,
  target.workflow_type AS target_workflow_type,
  target.task_queue AS target_task_queue,
  CASE WHEN resolved.id IS NOT NULL THEN 'resolved' ELSE 'signal_required' END AS outcome
FROM target
LEFT JOIN resolved ON resolved.id = target.id`;
