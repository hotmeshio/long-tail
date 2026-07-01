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
 * Free-text escalation search.
 *
 * The SDK's `client.list()` filters by structured columns only — it has no
 * free-text predicate. Long-tail's contract needs a search box that matches a
 * correlation key (order id, ticket id) or any visible field across the WHOLE
 * result set, not just the current page. That is server-side SQL here (over the
 * `lt_escalations` view, which adds the computed `available` flag), following the
 * same raw-SQL-on-the-shared-table pattern as the atomic resolve below — so the
 * filter flows SQL→service→API→route→dashboard rather than being faked client-side.
 *
 * All structured filters are optional and combine with the search term (AND).
 * `metadata::text ILIKE` scans the JSONB as text (the GIN index is containment-only
 * and cannot serve ILIKE) — bounded in practice by the other filters and the page.
 *
 * Role-scope visibility ($3 allRoles, $10 selfRoles, $11 meUserId):
 *   - global access  → $3 NULL and $10 NULL → no role filter (sees everything)
 *   - read_all roles → row.role ∈ $3
 *   - read_self roles → row.role ∈ $10 AND row.assigned_to = $11 (only the user's own)
 * The branches union, so a user with mixed scope (read_all on some roles, read_self
 * on others) is filtered correctly in one pass. `assigned_to` is indexed
 * (idx_lt_escalations_assigned), so the self-branch is index-served at scale.
 *
 * $1 status, $2 role, $3 allRoles (text[]), $4 type, $5 subtype, $6 priority,
 * $7 assigned_to, $8 available (bool), $9 search, $10 selfRoles (text[]),
 * $11 meUserId, $12 metadata (jsonb containment, GIN-served). The list query
 * adds $13 limit, $14 offset.
 *
 * `metadata @> $12` is exact JSONB containment (the GIN index serves it) — this is
 * how findByMetadata routes through the scoped query so its role-scope filter and
 * count run in SQL (no client-side filtering), the same as free-text/self-scope.
 */
const SEARCH_ESCALATIONS_WHERE = `\
  FROM public.lt_escalations
  WHERE ($1::text IS NULL OR status = $1)
    AND ($2::text IS NULL OR role = $2)
    AND (
         ($3::text[] IS NULL AND $10::text[] IS NULL)
      OR ($3::text[] IS NOT NULL AND role = ANY($3))
      OR ($10::text[] IS NOT NULL AND role = ANY($10) AND assigned_to = $11)
    )
    AND ($4::text IS NULL OR type = $4)
    AND ($5::text IS NULL OR subtype = $5)
    AND ($6::int IS NULL OR priority = $6)
    AND ($7::text IS NULL OR assigned_to = $7)
    AND ($8::boolean IS NULL OR available = $8)
    AND ($12::jsonb IS NULL OR metadata @> $12)
    AND ($9::text IS NULL OR (
          description ILIKE '%' || $9 || '%'
       OR type ILIKE '%' || $9 || '%'
       OR subtype ILIKE '%' || $9 || '%'
       OR role ILIKE '%' || $9 || '%'
       OR workflow_id ILIKE '%' || $9 || '%'
       OR origin_id ILIKE '%' || $9 || '%'
       OR id::text ILIKE '%' || $9 || '%'
       OR metadata::text ILIKE '%' || $9 || '%'
    ))`;

/** Count matching the search WHERE (params $1–$12). */
export const COUNT_SEARCH_ESCALATIONS = `SELECT COUNT(*)::int AS total\n${SEARCH_ESCALATIONS_WHERE}`;

/**
 * Build the search SELECT. `orderBy` is composed from a whitelist by the caller
 * (never raw user input), so it is safe to interpolate; everything else is bound.
 */
export function searchEscalationsQuery(orderBy: string): string {
  return `SELECT *\n${SEARCH_ESCALATIONS_WHERE}\n  ORDER BY ${orderBy}\n  LIMIT $13 OFFSET $14`;
}

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
 * $4 = metadata patch (jsonb, nullable), $5 = write_all roles (text[], null = global /
 * no filter), $6 = write_self roles (text[], nullable).
 *
 * Write-scope is folded into the same FOR UPDATE statement (no TOCTOU): the row
 * is resolvable if the caller has global access ($5 NULL), or the row's role is in
 * their write_all set, or the row's role is in their write_self set AND it is
 * already assigned to them ($2). assigned_to is indexed, so the self-branch scales.
 */
export const RESOLVE_BY_METADATA_ATOMIC = `\
WITH target AS MATERIALIZED (
  SELECT *
  FROM public.hmsh_escalations
  WHERE metadata @> $1::jsonb
    AND status = 'pending'
    AND (
         $5::text[] IS NULL
      OR role = ANY($5)
      OR (role = ANY($6::text[]) AND assigned_to = $2)
    )
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

/**
 * Station-metrics aggregation — one row per role.
 *
 * Produces all columns needed by the Operations dashboard:
 *   - Real-time counts: pending, claimed (actively held), in_arrears (past SLA)
 *   - Period counts: resolved in the selected window
 *   - Throughput efficiency: resolved / expected output × 100 (null when no target set)
 *   - Percentile distributions: P99/P50/avg/max for wait (queue time) and work (processing)
 *
 * Parameters:
 *   $1  TEXT[]   — role filter (NULL = all roles / superadmin)
 *   $2  INTERVAL — time window (e.g. '24 hours', '15 minutes')
 *
 * Three-CTE design — each CTE targets a different partial index to avoid a
 * full-table scan as row counts grow:
 *
 *   role_targets   lt_roles pk scan (tiny — drives outer LEFT JOINs)
 *   live_counts    idx_hmsh_esc_pending_role_created  (role, created_at DESC)
 *                  WHERE status='pending'
 *                  → pending count, active-claim count, in_arrears
 *   period_metrics idx_hmsh_esc_resolved_cover  (role, resolved_at DESC, claimed_at, created_at)
 *                  WHERE status='resolved'
 *                  → resolved count, throughput_pct, all latency percentiles
 *                  (index-only scan candidate once table > 10k rows)
 *
 * Latency semantics: wait and work times are computed over CLOSED work
 * (status='resolved' in the period) rather than mixing resolved + in-flight
 * items. This gives a cleaner "how did completed work perform?" answer for
 * a COO dashboard.
 *
 * Roles with no escalations still appear (driven by role_targets), so all
 * configured ops-visible stations show in the chart even when idle.
 */
export const STATION_METRICS_SQL = `
WITH
role_targets AS (
  SELECT role, target_per_hour, sla_minutes
  FROM lt_roles
  WHERE ($1::text[] IS NULL OR role = ANY($1::text[]))
),
live_counts AS (
  SELECT
    e.role,
    COUNT(*)                                                                         AS pending,
    COUNT(*) FILTER (WHERE e.assigned_to IS NOT NULL AND e.assigned_until > NOW())  AS claimed,
    COUNT(*) FILTER (
      WHERE rt.sla_minutes IS NOT NULL
        AND e.created_at < NOW() - (rt.sla_minutes * INTERVAL '1 minute')
    )                                                                                AS in_arrears
  FROM hmsh_escalations e
  JOIN role_targets rt ON rt.role = e.role
  WHERE e.status = 'pending'
  GROUP BY e.role
),
period_metrics AS (
  SELECT
    e.role,
    COUNT(*)                                                                         AS resolved,
    ROUND((PERCENTILE_CONT(0.99) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (e.claimed_at - e.created_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS p99_wait_min,
    ROUND((PERCENTILE_CONT(0.50) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (e.claimed_at - e.created_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS p50_wait_min,
    ROUND((AVG(EXTRACT(EPOCH FROM (e.claimed_at - e.created_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS avg_wait_min,
    ROUND((MAX(EXTRACT(EPOCH FROM (e.claimed_at - e.created_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS max_wait_min,
    ROUND((PERCENTILE_CONT(0.99) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (e.resolved_at - e.claimed_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS p99_work_min,
    ROUND((PERCENTILE_CONT(0.50) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (e.resolved_at - e.claimed_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS p50_work_min,
    ROUND((AVG(EXTRACT(EPOCH FROM (e.resolved_at - e.claimed_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS avg_work_min,
    ROUND((MAX(EXTRACT(EPOCH FROM (e.resolved_at - e.claimed_at)) / 60)
      FILTER (WHERE e.claimed_at IS NOT NULL))::numeric, 3)                        AS max_work_min
  FROM hmsh_escalations e
  WHERE e.status = 'resolved'
    AND e.resolved_at >= NOW() - $2::interval
    AND ($1::text[] IS NULL OR e.role = ANY($1::text[]))
  GROUP BY e.role
)
SELECT
  rt.role,
  COALESCE(lc.pending,    0)    AS pending,
  COALESCE(lc.claimed,    0)    AS claimed,
  COALESCE(pm.resolved,   0)    AS resolved,
  COALESCE(lc.in_arrears, 0)    AS in_arrears,
  ROUND(
    (COALESCE(pm.resolved, 0)::numeric
      / NULLIF(rt.target_per_hour::numeric * EXTRACT(EPOCH FROM $2::interval) / 3600.0, 0)
      * 100
    )::numeric, 1
  )                             AS throughput_pct,
  pm.p99_wait_min,
  pm.p50_wait_min,
  pm.avg_wait_min,
  pm.max_wait_min,
  pm.p99_work_min,
  pm.p50_work_min,
  pm.avg_work_min,
  pm.max_work_min
FROM role_targets rt
LEFT JOIN live_counts   lc ON lc.role = rt.role
LEFT JOIN period_metrics pm ON pm.role = rt.role
ORDER BY rt.role
`;
