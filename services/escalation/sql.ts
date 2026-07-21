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
 * Escalation search by correlation id.
 *
 * The SDK's `client.list()` filters by structured columns only. Long-tail adds a
 * search box that resolves a correlation id — the escalation id, its workflow id,
 * or the origin id (order/ticket) — to the matching rows across the WHOLE result
 * set, not just the current page. This is exact-match (equality), so it stays
 * index-served: `origin_id` and `workflow_id` each have a btree index and `id` is
 * the primary key. It deliberately does NOT run substring `ILIKE` over free text
 * or `metadata::text` — a leading-wildcard ILIKE cannot use any index and would
 * sequentially scan (and cast to text) every row, unbounded by history size.
 *
 * Metadata is searched precisely through the GIN-served `metadata @> $12`
 * containment path instead (see `searchEscalationsFaceted`), which needs no status
 * filter — e.g. "every escalation for order X, any status" is one indexed lookup.
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
 * $7 assigned_to, $8 available (bool), $9 search (exact workflow_id/origin_id
 * match), $10 selfRoles (text[]), $11 meUserId, $12 metadata (jsonb containment,
 * GIN-served), $13 search-as-uuid (the search term when it parses as a UUID,
 * else NULL). The list query adds $14 limit, $15 offset.
 *
 * The id arm binds $13::uuid instead of comparing id::text = $9: casting the
 * uuid COLUMN to text has no index path, and one unindexable arm forces the
 * whole OR off BitmapOr into a full scan of escalation history. With the
 * app-side parse, all three arms are index-served (origin/workflow btrees, PK).
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
    AND ($9::text IS NULL OR origin_id = $9 OR workflow_id = $9
      OR ($13::uuid IS NOT NULL AND id = $13::uuid))`;

/** Count matching the search WHERE (params $1–$13). */
export const COUNT_SEARCH_ESCALATIONS = `SELECT COUNT(*)::int AS total\n${SEARCH_ESCALATIONS_WHERE}`;

/**
 * Build the search SELECT. `orderBy` is composed from a whitelist by the caller
 * (never raw user input), so it is safe to interpolate; everything else is bound.
 */
export function searchEscalationsQuery(orderBy: string): string {
  return `SELECT *\n${SEARCH_ESCALATIONS_WHERE}\n  ORDER BY ${orderBy}\n  LIMIT $14 OFFSET $15`;
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
 * no filter), $6 = write_self roles (text[], nullable), $7 = enforcing roles
 * (text[], null = none), $8 = assert id (uuid, nullable).
 *
 * Write-scope is folded into the same FOR UPDATE statement (no TOCTOU): the row
 * is resolvable if the caller has global access ($5 NULL), or the row's role is in
 * their write_all set, or the row's role is in their write_self set AND it is
 * already assigned to them ($2). assigned_to is indexed, so the self-branch scales.
 *
 * Schema enforcement rides as a fifth outcome: when the target's role is in $7,
 * NOTHING is written — the statement returns 'validation_required' with the
 * row's role/metadata/envelope so the API layer can validate the payload, then
 * re-invoke with $8 = the validated row's id and $7 = NULL. The asserted second
 * pass claims + resolves exactly as a first pass would (state re-asserted:
 * status must still be pending and the id must still match, so a concurrent
 * resolution surfaces as zero rows → the caller's conflict handling). This is
 * the same pick-then-guarded-finish shape the signal outcomes already use.
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
    AND ($8::uuid IS NULL OR id = $8::uuid)
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
    AND ($7::text[] IS NULL OR NOT (target.role = ANY($7)))
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
  target.role AS target_role,
  target.metadata AS target_metadata,
  target.envelope AS target_envelope,
  target.escalation_payload AS target_escalation_payload,
  target.metadata->>'signal_id' AS signal_id,
  target.signal_key AS signal_key,
  target.workflow_id AS target_workflow_id,
  target.workflow_type AS target_workflow_type,
  target.task_queue AS target_task_queue,
  (target.assigned_to IS NOT NULL
    AND target.assigned_until IS NOT NULL
    AND target.assigned_until > NOW()) AS signal_already_claimed,
  CASE
    WHEN resolved.id IS NOT NULL THEN 'resolved'
    WHEN $7::text[] IS NOT NULL AND target.role = ANY($7) THEN 'validation_required'
    ELSE 'signal_required'
  END AS outcome
FROM target
LEFT JOIN resolved ON resolved.id = target.id`;

// ---------------------------------------------------------------------------
// Station metrics — split into two queries with very different cost profiles.
//
// The Operations dashboard refreshes on every escalation socket event (a
// debounced burst) plus a periodic fallback. Computing percentiles on that hot
// path is wasteful: percentile aggregates sort every qualifying resolved row,
// while the live counts are cheap and bounded. So the two halves are separated:
//
//   STATION_LIVE_COUNTS_SQL    — pending / claimed / priority_count. Cheap, always
//                                run fresh. Scans only pending rows (backlog is
//                                bounded no matter how much history accrues).
//   STATION_PERIOD_METRICS_SQL — resolved / throughput / latency percentiles.
//                                Expensive, slow-changing; the service layer
//                                caches it (~30s) and shares it across the
//                                refresh burst and all concurrent viewers.
//
// Both drive off role_targets so every configured role appears even when idle,
// and the service merges them by role into one StationMetric per station.
// ---------------------------------------------------------------------------

/**
 * Live counts — pending, active claims, and priority (past-threshold) per role.
 *
 * $1 TEXT[] — role filter (NULL = all roles / superadmin).
 *
 * Hits idx_hmsh_esc_pending_role_created (role, created_at DESC) WHERE
 * status='pending'. The pending working set is bounded by real backlog depth,
 * so this stays cheap as historical volume grows — safe on the hot refresh path.
 *
 * priority_count is the Pace Board rebalance signal: pending AND unclaimed
 * items older than the role's threshold. One signal, two per-role dials with
 * fallbacks so it works from sla_minutes alone:
 *
 *   age origin — priority_facet metadata key (an ISO 8601 UTC timestamp, e.g.
 *                the order's authorized date) when set, else created_at.
 *   threshold  — priority_threshold_minutes when set, else sla_minutes.
 *
 * Claimed items are excluded — they are already in someone's hands; the count
 * is what the floor must still pull forward. The GIN metadata index only
 * serves containment, not age comparisons, so the facet read rides the same
 * bounded pending scan as the other counts. The cast is guarded by
 * pg_input_is_valid inside a CASE (Postgres does not promise AND evaluation
 * order) so one malformed metadata value can never break the stats query;
 * with a facet configured, items missing the key or holding an unparseable
 * value do not count (NULL age never passes the comparison).
 */
export const STATION_LIVE_COUNTS_SQL = `
WITH role_targets AS (
  SELECT role, sla_minutes, priority_threshold_minutes, priority_facet
  FROM lt_roles
  WHERE ($1::text[] IS NULL OR role = ANY($1::text[]))
),
live_counts AS (
  SELECT
    e.role,
    COUNT(*)                                                                         AS pending,
    COUNT(*) FILTER (WHERE e.assigned_to IS NOT NULL AND e.assigned_until > NOW())  AS claimed,
    COUNT(*) FILTER (
      WHERE COALESCE(rt.priority_threshold_minutes, rt.sla_minutes) IS NOT NULL
        AND (e.assigned_to IS NULL OR e.assigned_until IS NULL OR e.assigned_until <= NOW())
        AND CASE
          WHEN rt.priority_facet IS NULL THEN e.created_at
          WHEN pg_input_is_valid(e.metadata->>rt.priority_facet, 'timestamptz')
            THEN (e.metadata->>rt.priority_facet)::timestamptz
          ELSE NULL
        END < NOW() - (COALESCE(rt.priority_threshold_minutes, rt.sla_minutes) * INTERVAL '1 minute')
    )                                                                                AS priority_count
  FROM hmsh_escalations e
  JOIN role_targets rt ON rt.role = e.role
  WHERE e.status = 'pending'
  GROUP BY e.role
)
SELECT
  rt.role,
  COALESCE(lc.pending,        0) AS pending,
  COALESCE(lc.claimed,        0) AS claimed,
  COALESCE(lc.priority_count, 0) AS priority_count
FROM role_targets rt
LEFT JOIN live_counts lc ON lc.role = rt.role
ORDER BY rt.role
`;

/**
 * Period metrics — resolved count, throughput efficiency, and P99/P50/avg/max
 * latency for wait (queue time) and work (processing) per role.
 *
 * $1 TEXT[]   — role filter (NULL = all roles / superadmin).
 * $2 INTERVAL — time window (e.g. '24 hours', '15 minutes').
 *
 * Hits idx_hmsh_esc_resolved_cover (role, resolved_at DESC, claimed_at,
 * created_at) WHERE status='resolved' — a covering index, so the percentile
 * scan is index-only. PERCENTILE_CONT still sorts the qualifying set in memory,
 * which is why the service caches this result rather than running it per event.
 *
 * Latency is computed over CLOSED work (status='resolved' in the period), not a
 * mix of resolved + in-flight — a clean "how did completed work perform?" read.
 * throughput_pct is NULL when the role has no target_per_hour (NULLIF guard).
 */
export const STATION_PERIOD_METRICS_SQL = `
WITH role_targets AS (
  SELECT role, target_per_hour
  FROM lt_roles
  WHERE ($1::text[] IS NULL OR role = ANY($1::text[]))
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
  COALESCE(pm.resolved, 0) AS resolved,
  ROUND(
    (COALESCE(pm.resolved, 0)::numeric
      / NULLIF(rt.target_per_hour::numeric * EXTRACT(EPOCH FROM $2::interval) / 3600.0, 0)
      * 100
    )::numeric, 1
  )                        AS throughput_pct,
  pm.p99_wait_min,
  pm.p50_wait_min,
  pm.avg_wait_min,
  pm.max_wait_min,
  pm.p99_work_min,
  pm.p50_work_min,
  pm.avg_work_min,
  pm.max_work_min
FROM role_targets rt
LEFT JOIN period_metrics pm ON pm.role = rt.role
ORDER BY rt.role
`;
