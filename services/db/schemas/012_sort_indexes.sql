-- Indexes to support user-chosen sort orders on list pages.

-- Escalations: created_at DESC (default when user sorts by newest first)
CREATE INDEX IF NOT EXISTS idx_lt_escalations_created_desc
  ON lt_escalations (created_at DESC);

-- Escalations: updated_at DESC
CREATE INDEX IF NOT EXISTS idx_lt_escalations_updated_desc
  ON lt_escalations (updated_at DESC);

-- Escalations: priority DESC (reverse priority sort)
CREATE INDEX IF NOT EXISTS idx_lt_escalations_priority_desc
  ON lt_escalations (priority DESC, created_at DESC);
