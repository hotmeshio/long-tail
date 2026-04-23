-- Ensure all system leaf workflows have config entries.
-- Migrations 004/005 tried to UPDATE these but they were never seeded —
-- the interceptor needs config entries to wrap workflows with lifecycle events.

INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, invocable, description, tool_tags)
VALUES
  ('mcpQuery', 'long-tail-system', 'engineer', false,
   'Dynamic MCP tool orchestration — LLM agentic loop with raw MCP tools',
   '{}'),
  ('mcpTriage', 'long-tail-system', 'engineer', false,
   'Dynamic MCP triage — LLM agentic loop for escalation remediation',
   '{}'),
  ('mcpWorkflowBuilder', 'long-tail-system', 'engineer', false,
   'Direct pipeline builder — LLM constructs DAG from tool schemas',
   '{}'),
  ('mcpWorkflowPlanner', 'long-tail-system', 'engineer', false,
   'Plan mode — decomposes specifications into multi-workflow sets',
   '{}')
ON CONFLICT (workflow_type) DO NOTHING;

-- Assign roles
INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpQuery', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;

INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpTriage', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;

INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpWorkflowBuilder', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;

INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpWorkflowPlanner', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;
