-- Register MCP triage workflow so the interceptor treats it as an LT workflow.
-- mcpTriage is a leaf workflow that handles the full triage lifecycle:
-- LLM diagnosis, tool-assisted remediation, and exit vortex routing.

INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, invocable, description)
VALUES
  ('mcpTriage', true, false, 'long-tail-system', 'engineer', 'default', false,
   'MCP triage — remediates stalled workflows using MCP tools and engineer guidance')
ON CONFLICT (workflow_type) DO NOTHING;

-- Register mcpQuery — general-purpose "do anything with tools" workflow.
-- invocable: true so it can be triggered via the dashboard or API.
INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, invocable, description)
VALUES
  ('mcpQuery', true, false, 'long-tail-system', 'engineer', 'default', true,
   'Do anything with tools — browser automation, file operations, HTTP requests, database queries, document processing, and more')
ON CONFLICT (workflow_type) DO NOTHING;

-- Envelope schema for mcpQuery (invocable entry point)
UPDATE lt_config_workflows SET envelope_schema = '{
  "data": {"prompt": "Describe what you want to accomplish using available tools..."},
  "metadata": {"source": "dashboard"}
}'::jsonb
WHERE workflow_type = 'mcpQuery' AND envelope_schema IS NULL;

-- Assign roles so escalations from triage are visible to the right people
INSERT INTO lt_config_roles (workflow_type, role)
SELECT wt, unnest(ARRAY['reviewer', 'engineer', 'admin'])
FROM unnest(ARRAY['mcpTriage', 'mcpQuery']) AS wt
ON CONFLICT (workflow_type, role) DO NOTHING;
