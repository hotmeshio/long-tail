-- Split mcpQuery into router + dynamic + deterministic workflows.
-- mcpQueryRouter is the new entry point (orchestrator).
-- mcpQuery becomes dynamic-only (leaf).
-- mcpDeterministic invokes compiled YAML workflows (leaf).

-- Update existing mcpQuery: no longer directly invocable (called via router)
UPDATE lt_config_workflows
SET invocable = false,
    description = 'Dynamic MCP tool orchestration — LLM agentic loop with raw MCP tools'
WHERE workflow_type = 'mcpQuery';

-- Add mcpQueryRouter (orchestrator — the new entry point)
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, default_modality, invocable, description, tool_tags, envelope_schema)
VALUES
  ('mcpQueryRouter', 'long-tail-system', 'engineer', 'default', true,
   'Do anything with tools — browser automation, file operations, HTTP requests, database queries, document processing, and more',
   '{}',
   '{"data": {"prompt": "Describe what you want to accomplish using available tools..."}, "metadata": {"source": "dashboard"}}'::jsonb)
ON CONFLICT (workflow_type) DO NOTHING;

-- Add mcpDeterministic (leaf — invokes compiled YAML workflows)
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, default_modality, invocable, description, tool_tags)
VALUES
  ('mcpDeterministic', 'long-tail-system', 'engineer', 'default', false,
   'Deterministic execution — invokes matched compiled YAML workflows with extracted inputs',
   '{}')
ON CONFLICT (workflow_type) DO NOTHING;

-- Assign roles
INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpQueryRouter', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;

INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpDeterministic', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;
