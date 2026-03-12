// ---------------------------------------------------------------------------
// Escalation SQL – externalized from crud.ts, bulk.ts, queries.ts
// ---------------------------------------------------------------------------

// --- Role management -------------------------------------------------------

export const ENSURE_ROLE_EXISTS =
  'INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING';

// --- Single-record CRUD ---------------------------------------------------

export const CREATE_ESCALATION = `\
INSERT INTO lt_escalations
  (type, subtype, modality, description, priority, task_id,
   origin_id, parent_id, role, envelope, metadata, escalation_payload,
   workflow_id, task_queue, workflow_type, trace_id, span_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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

export const LIST_DISTINCT_TYPES =
  'SELECT DISTINCT type FROM lt_escalations ORDER BY type';
