-- A provider wait can name a signal key, so the signal-key surfaces address
-- it as they address a HotMesh escalation. The key lives here, never on the
-- escalation row, so the escalation store never composes a HotMesh wake for it.
-- Unique for the life of the row, as HotMesh's escalation signal keys are.

ALTER TABLE lt_durable_waits ADD COLUMN IF NOT EXISTS signal_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_durable_waits_signal_key
  ON lt_durable_waits (signal_key) WHERE signal_key IS NOT NULL;
