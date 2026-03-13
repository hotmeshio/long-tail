-- Add tool_tags column to lt_config_workflows.
-- When a workflow type escalates to triage, these tags scope
-- which MCP servers are loaded (via findServersByTags).

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS tool_tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_config_workflows_tool_tags
  ON lt_config_workflows USING GIN (tool_tags);

-- Seed tool_tags for existing workflow types with known tool affinities
UPDATE lt_config_workflows SET tool_tags = ARRAY['document-processing', 'vision', 'ocr', 'translation']
  WHERE workflow_type IN ('verifyDocument', 'verifyDocumentMcp');

UPDATE lt_config_workflows SET tool_tags = ARRAY['document-processing', 'vision', 'database', 'query']
  WHERE workflow_type = 'processClaim';

UPDATE lt_config_workflows SET tool_tags = ARRAY['document-processing', 'vision', 'ocr', 'translation']
  WHERE workflow_type = 'reviewContent';
