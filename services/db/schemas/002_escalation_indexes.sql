-- Escalation indexes for stats, list, and type lookup queries.

-- Supports SELECT DISTINCT type and WHERE type = ... filters.
CREATE INDEX IF NOT EXISTS idx_lt_escalations_type
  ON lt_escalations (type);

-- Supports ORDER BY priority ASC, created_at ASC used by
-- listEscalations and listAvailableEscalations (pending rows only).
CREATE INDEX IF NOT EXISTS idx_lt_escalations_pending_sort
  ON lt_escalations (priority ASC, created_at ASC)
  WHERE status = 'pending';
