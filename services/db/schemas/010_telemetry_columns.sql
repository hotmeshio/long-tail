-- Add trace/span columns for OpenTelemetry correlation.
-- Allows tasks and escalations to be linked to Honeycomb traces.

ALTER TABLE lt_tasks ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE lt_tasks ADD COLUMN IF NOT EXISTS span_id TEXT;

CREATE INDEX IF NOT EXISTS idx_lt_tasks_trace
  ON lt_tasks (trace_id) WHERE trace_id IS NOT NULL;

ALTER TABLE lt_escalations ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE lt_escalations ADD COLUMN IF NOT EXISTS span_id TEXT;

CREATE INDEX IF NOT EXISTS idx_lt_escalations_trace
  ON lt_escalations (trace_id) WHERE trace_id IS NOT NULL;
