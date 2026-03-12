-- Register MCP triage workflows so the interceptor treats them as LT workflows.
-- mcpTriageOrchestrator is a container (calls executeLT internally).
-- mcpTriage is a leaf workflow that can escalate to engineer for guided remediation.

INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, invocable, description)
VALUES
  ('mcpTriage', true, false, 'lt-mcp-triage', 'engineer', 'default', false,
   'MCP triage leaf — remediates stalled workflows using MCP tools and engineer guidance'),
  ('mcpTriageOrchestrator', true, true, 'lt-mcp-triage-orch', 'engineer', 'default', false,
   'MCP triage container — orchestrates the triage lifecycle and signals back to the original parent')
ON CONFLICT (workflow_type) DO NOTHING;

-- Register mcpQuery — general-purpose "do anything with tools" workflow.
-- invocable: true so it can be triggered via the dashboard or API.
INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, invocable, description)
VALUES
  ('mcpQuery', true, false, 'lt-mcp-query', 'engineer', 'default', true,
   'General-purpose MCP query — fulfills arbitrary requests using all available MCP tools')
ON CONFLICT (workflow_type) DO NOTHING;

-- Assign roles so escalations from triage are visible to the right people
INSERT INTO lt_config_roles (workflow_type, role)
SELECT wt, unnest(ARRAY['reviewer', 'engineer', 'admin'])
FROM unnest(ARRAY['mcpTriage', 'mcpTriageOrchestrator', 'mcpQuery']) AS wt
ON CONFLICT (workflow_type, role) DO NOTHING;
