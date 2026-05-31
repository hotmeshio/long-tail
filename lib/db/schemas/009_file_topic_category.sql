-- Add 'file' to the topic catalog category check constraint.

ALTER TABLE lt_topic_catalog
  DROP CONSTRAINT IF EXISTS lt_topic_catalog_category_check;

ALTER TABLE lt_topic_catalog
  ADD CONSTRAINT lt_topic_catalog_category_check
  CHECK (category IN (
    'task','workflow','escalation','activity','knowledge','file','agent','app','milestone'
  ));
