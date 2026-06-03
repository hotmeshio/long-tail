-- GIN index for JSONB containment queries on lt_escalations.metadata.
-- Enables efficient lookups like: WHERE metadata @> '{"orderId":"order-123"}'::jsonb
-- Uses jsonb_path_ops (smaller, faster for @> queries).
CREATE INDEX IF NOT EXISTS idx_lt_escalations_metadata
  ON lt_escalations USING GIN (metadata jsonb_path_ops);
