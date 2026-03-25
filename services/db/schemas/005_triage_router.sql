-- Split mcpTriage into router + dynamic + deterministic workflows.
-- mcpTriageRouter is the new entry point (orchestrator).
-- mcpTriage becomes dynamic-only (leaf).
-- mcpTriageDeterministic invokes compiled YAML workflows (leaf).

-- Update existing mcpTriage: no longer directly invocable (called via router)
UPDATE lt_config_workflows
SET invocable = false,
    description = 'Dynamic MCP triage — LLM agentic loop for escalation remediation'
WHERE workflow_type = 'mcpTriage';

-- Add mcpTriageRouter (orchestrator — the new entry point for triage)
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, default_modality, invocable, description, tool_tags)
VALUES
  ('mcpTriageRouter', 'long-tail-system', 'engineer', 'default', false,
   'Triage router — discovers compiled workflows for remediation, routes to deterministic or dynamic triage',
   '{}')
ON CONFLICT (workflow_type) DO NOTHING;

-- Add mcpTriageDeterministic (leaf — invokes compiled triage workflows)
INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, default_modality, invocable, description, tool_tags)
VALUES
  ('mcpTriageDeterministic', 'long-tail-system', 'engineer', 'default', false,
   'Deterministic triage — invokes matched compiled workflows for escalation remediation',
   '{}')
ON CONFLICT (workflow_type) DO NOTHING;

-- Assign roles
INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpTriageRouter', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;

INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'mcpTriageDeterministic', unnest(ARRAY['reviewer', 'engineer', 'admin'])
ON CONFLICT (workflow_type, role) DO NOTHING;
