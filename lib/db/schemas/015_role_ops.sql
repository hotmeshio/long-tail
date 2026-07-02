-- Migration 015: Role operational columns
--
-- Promotes the COO operational triangle to first-class typed columns on lt_roles
-- instead of loose keys inside the properties JSONB bag.
--
-- Triangle: if you know any two, the third is derived.
--   throughput = worker_count / (sla_minutes / 60)
--   worker_count = target_per_hour × (sla_minutes / 60)
--   sla_minutes  = worker_count / target_per_hour × 60
--
-- Also formalises metadata_schema: a JSON Schema document that declares the
-- expected shape of lt_escalations.metadata for escalations created under
-- this role. Drives faceted-query key autocomplete and creation-time validation.
--
-- properties remains a free user-owned JSONB bag — no reserved keys.

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS sla_minutes      NUMERIC,
  ADD COLUMN IF NOT EXISTS target_per_hour  NUMERIC,
  ADD COLUMN IF NOT EXISTS worker_count     NUMERIC,
  ADD COLUMN IF NOT EXISTS metadata_schema  JSONB;

-- Migrate values that lived in the properties bag (common key names).
-- The bag is user-owned free text, so every cast is guarded: only JSON numbers
-- and numeric strings are promoted. An unparseable value (e.g. "30 min") is
-- left in the bag rather than aborting the migration transaction and
-- crash-looping every container at boot.
UPDATE lt_roles
SET sla_minutes = (properties->>'sla_minutes')::numeric
WHERE sla_minutes IS NULL
  AND (jsonb_typeof(properties->'sla_minutes') = 'number'
       OR properties->>'sla_minutes' ~ '^[0-9]+(\.[0-9]+)?$');

UPDATE lt_roles
SET sla_minutes = (properties->>'tat_minutes')::numeric
WHERE sla_minutes IS NULL
  AND (jsonb_typeof(properties->'tat_minutes') = 'number'
       OR properties->>'tat_minutes' ~ '^[0-9]+(\.[0-9]+)?$');

UPDATE lt_roles
SET target_per_hour = (properties->>'target_per_hour')::numeric
WHERE target_per_hour IS NULL
  AND (jsonb_typeof(properties->'target_per_hour') = 'number'
       OR properties->>'target_per_hour' ~ '^[0-9]+(\.[0-9]+)?$');

UPDATE lt_roles
SET worker_count = (properties->>'worker_count')::numeric
WHERE worker_count IS NULL
  AND (jsonb_typeof(properties->'worker_count') = 'number'
       OR properties->>'worker_count' ~ '^[0-9]+(\.[0-9]+)?$');
