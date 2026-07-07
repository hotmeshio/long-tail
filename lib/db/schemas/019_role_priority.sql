-- Migration 019: Role priority threshold
--
-- Per-role tuning for the Pace Board priority count: pending, unclaimed
-- escalations whose age exceeds the threshold appear as a count the floor
-- pulls to the front of the rack. The signal is deliberately boolean per
-- item (past threshold or not) — a count to rebalance by, not a queue to
-- keep re-sorting.
--
--   priority_threshold_minutes — max age before an item counts as priority.
--                                Falls back to sla_minutes when NULL.
--   priority_facet             — lt_escalations.metadata key holding the age
--                                origin as an ISO 8601 UTC timestamp (e.g.
--                                the order's authorized date). Falls back to
--                                created_at when NULL. When set, items
--                                missing the key or holding an unparseable
--                                value are not counted.
--
-- With both NULL the count still works for any role with sla_minutes set
-- (age from created_at) — one signal, no parallel SLA pattern.
--
-- No new lt_escalations index: the count rides the bounded pending-only scan
-- in STATION_LIVE_COUNTS_SQL. The GIN metadata index only serves containment
-- (@>), not age comparisons, and the pending working set is bounded by real
-- backlog depth.

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS priority_threshold_minutes NUMERIC,
  ADD COLUMN IF NOT EXISTS priority_facet             TEXT;
