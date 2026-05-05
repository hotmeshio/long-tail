-- System seed data: built-in MCP server, system workflow configs, escalation chains.
-- Example workflow configs are seeded at runtime when examples: true.

-- ─── Built-in MCP server ───────────────────────────────────────────────────

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

-- ─── Escalation chains ─────────────────────────────────────────────────────

INSERT INTO lt_config_role_escalations (source_role, target_role) VALUES
  ('reviewer',  'engineer'),
  ('reviewer',  'admin'),
  ('engineer',  'admin'),
  ('engineer',  'superadmin'),
  ('admin',     'engineer'),
  ('admin',     'superadmin')
ON CONFLICT DO NOTHING;

-- ─── System workflow configs ────────────────────────────────────────────────

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

-- Query router (orchestrator entry point)
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, invocable, description, tool_tags, envelope_schema)
VALUES
  ('mcpQueryRouter', 'long-tail-system', 'engineer', true,
   'Do anything with tools — browser automation, file operations, HTTP requests, database queries, document processing, and more',
   '{}',
   '{"data": {"prompt": "Describe what you want to accomplish using available tools..."}, "metadata": {"source": "dashboard"}}'::jsonb)
ON CONFLICT (workflow_type) DO NOTHING;

-- Deterministic execution (compiled YAML workflows)
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, invocable, description, tool_tags)
VALUES
  ('mcpDeterministic', 'long-tail-system', 'engineer', false,
   'Deterministic execution — invokes matched compiled YAML workflows with extracted inputs',
   '{}')
ON CONFLICT (workflow_type) DO NOTHING;

-- Triage router
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, invocable, description, tool_tags)
VALUES
  ('mcpTriageRouter', 'long-tail-system', 'engineer', false,
   'Triage router — discovers compiled workflows for remediation, routes to deterministic or dynamic triage',
   '{}')
ON CONFLICT (workflow_type) DO NOTHING;

-- Triage deterministic
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, invocable, description, tool_tags)
VALUES
  ('mcpTriageDeterministic', 'long-tail-system', 'engineer', false,
   'Deterministic triage — invokes matched compiled workflows for escalation remediation',
   '{}')
ON CONFLICT (workflow_type) DO NOTHING;

-- ─── Assign roles to all system workflows ──────────────────────────────────

INSERT INTO lt_config_roles (workflow_type, role)
SELECT wt, unnest(ARRAY['reviewer', 'engineer', 'admin'])
FROM unnest(ARRAY[
  'mcpQuery', 'mcpTriage', 'mcpWorkflowBuilder', 'mcpWorkflowPlanner',
  'mcpQueryRouter', 'mcpDeterministic', 'mcpTriageRouter', 'mcpTriageDeterministic'
]) AS wt
ON CONFLICT (workflow_type, role) DO NOTHING;
