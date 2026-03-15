-- Seed the DB query MCP server (builtin, always available).
INSERT INTO lt_mcp_servers (name, description, transport_type, transport_config, auto_connect, status)
VALUES (
  'long-tail-db-query',
  'Built-in read-only query server for tasks, escalations, processes, and system health',
  'stdio',
  '{"builtin": true}'::jsonb,
  false,
  'connected'
)
ON CONFLICT (name) DO NOTHING;

-- Register the insightQuery workflow so the interceptor treats it as an LT workflow.
INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, invocable, description)
VALUES
  ('insightQuery', true, false, 'long-tail-system', 'admin', 'default', false,
   'AI-powered insight query — answers natural language questions about system state using DB tools')
ON CONFLICT (workflow_type) DO NOTHING;

-- Assign roles for the insight workflow
INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'insightQuery', unnest(ARRAY['admin', 'superadmin', 'engineer'])
ON CONFLICT (workflow_type, role) DO NOTHING;
