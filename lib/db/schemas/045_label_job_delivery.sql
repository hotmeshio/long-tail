-- Migration 045: delivery stamps on the label ledger
--
-- A job sent through a printer transport is recorded first, then delivered.
-- delivery_claimed_at is a short lease one process takes before sending, so
-- a retried request (same idempotency key) re-sends only an undelivered job
-- whose lease has lapsed: never twice at once, never lost after a crash
-- between record and send. delivered_at is stamped once the transport
-- accepts. These two columns are the only ones the platform updates.

ALTER TABLE lt_label_jobs
  ADD COLUMN IF NOT EXISTS delivery_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS lt_label_jobs_template_idx ON lt_label_jobs (template_name, created_at DESC);
