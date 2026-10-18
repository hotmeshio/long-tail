-- Migration 039: single-use NATS WebSocket proxy tickets
--
-- A ticket admits one upgrade. The proxy records its id here when it is
-- spent; a second upgrade with the same ticket finds the row and is refused.
-- Rows are kept until the ticket expires.

CREATE TABLE IF NOT EXISTS lt_nats_ws_tickets (
  jti        TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lt_nats_ws_tickets_expires ON lt_nats_ws_tickets (expires_at);
