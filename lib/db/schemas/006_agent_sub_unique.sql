-- Add unique constraint on (agent_id, topic) for idempotent subscription seeding.
-- Two containers inserting the same subscription simultaneously: one wins, other is a no-op.

DO $$ BEGIN
  ALTER TABLE lt_agent_subscriptions
    ADD CONSTRAINT uq_agent_sub_topic UNIQUE (agent_id, topic);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
