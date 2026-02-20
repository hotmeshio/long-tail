-- 003_implicit_claims.sql
-- Remove 'claimed' as an explicit status. Claims are now implicit:
-- assigned_to IS NOT NULL AND assigned_until > NOW() means "claimed".
-- Expired claims auto-release: queries check assigned_until <= NOW().

-- 1. Convert existing claimed escalations to pending
--    (their assigned_to / assigned_until fields already hold the claim data)
UPDATE lt_escalations
SET status = 'pending'
WHERE status = 'claimed';

-- 2. Partial index for "available escalations" query pattern
--    Available = pending AND (unassigned OR expired assignment)
CREATE INDEX IF NOT EXISTS idx_lt_escalations_available_v2
  ON lt_escalations (role, priority, created_at DESC)
  WHERE status = 'pending';
