-- ─── lt_escalations index audit ────────────────────────────────────────────
--
-- Motivation (hotmesh 0.20.0, PR perf/claim-path-hotspots):
--   Each stream/queue row pays index maintenance on every INSERT and on every
--   non-HOT UPDATE that touches an indexed column. The HITL claim path is
--   UPDATE-heavy (claim/resolve/release touch status, assigned_to,
--   assigned_until, claimed_at, priority, metadata, role — nearly all indexed),
--   so every claim is a non-HOT update that maintains all 18 btree indexes plus
--   the metadata GIN. 0.20.0 cut redundant stream-table indexes for exactly this
--   reason; this migration applies the same discipline to lt_escalations.
--
-- Scope: only drop indexes that are PROVABLY redundant — a strict leading-prefix
--   subset of another index whose partial predicate is no stricter. Anything that
--   merely "looks" duplicative is left in place and flagged below for EXPLAIN-driven
--   review against production data, not dropped speculatively.

-- 1. idx_lt_escalations_role_type (role, status, type, created_at DESC)
--    is an exact leading prefix of
--    idx_lt_escalations_role_subtype (role, status, type, subtype, created_at DESC).
--    Every query the former can serve (equality/range on role,status,type and the
--    created_at ordering) is served by the latter scanning the same prefix.
DROP INDEX IF EXISTS idx_lt_escalations_role_type;

-- 2. idx_lt_escalations_origin_id (origin_id) WHERE origin_id IS NOT NULL
--    is fully covered by idx_lt_escalations_origin (origin_id, created_at DESC):
--    `origin_id = $1` implies `origin_id IS NOT NULL`, origin_id leads the composite,
--    and the composite additionally serves the `ORDER BY created_at DESC` used by
--    GET_ESCALATIONS_BY_ORIGIN_ID. The partial index adds no reachable plan.
DROP INDEX IF EXISTS idx_lt_escalations_origin_id;

-- ── Review candidates (NOT dropped — verify with EXPLAIN on production volume) ──
--
-- These overlap but are not provably redundant. Confirm with EXPLAIN (ANALYZE,
-- BUFFERS) on representative data before removing any of them:
--
--   idx_lt_escalations_available (status, role, assigned_until, created_at DESC)
--     vs idx_lt_escalations_available_v2 (role, priority, created_at DESC)
--        WHERE status = 'pending'
--     The "_v2" naming implies intent to supersede v1, but v1 is full-table and
--     v1 alone positions assigned_until for the available-pool predicate. Confirm
--     which (if either) the listAvailableEscalations plan actually uses.
--
--   idx_lt_escalations_status (status, created_at DESC)
--     Partially overlaps status-leading composites, but is the only index that
--     serves `status = $1 ORDER BY created_at DESC` index-ordered for non-pending
--     statuses. Keep unless EXPLAIN shows it unused.
--
--   idx_lt_escalations_priority_desc (priority DESC, created_at DESC)
--     Backs the user-selectable `sort_by=priority` dashboard sort (SORTABLE_COLUMNS).
--     Keep while that sort is exposed.
