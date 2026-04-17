-- Remove delivery modality — the concept was never used for actual routing.
-- Alpha cleanup: drop from config, escalations, and tasks tables.

ALTER TABLE lt_config_workflows DROP COLUMN IF EXISTS default_modality;
ALTER TABLE lt_escalations DROP COLUMN IF EXISTS modality;
ALTER TABLE lt_tasks DROP COLUMN IF EXISTS modality;
