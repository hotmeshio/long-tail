-- Register processClaim workflows so the interceptor treats them as LT workflows.
-- processClaimOrchestrator is a container (invocable entry point from Dashboard).
-- processClaim is the leaf workflow that can escalate to reviewer.

INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, invocable, description, envelope_schema)
VALUES
  ('processClaim', true, false, 'lt-process-claim', 'reviewer', 'default', false,
   'Process claim leaf — analyzes insurance claim documents and validates claims',
   NULL),
  ('processClaimOrchestrator', true, true, 'lt-process-claim-orch', 'reviewer', 'default', true,
   'Process claim — insurance claim processing with document analysis',
   '{"data": {"claimId": "CLM-2024-001", "claimantId": "POL-5551234", "claimType": "auto_collision", "amount": 12500, "documents": ["incident_report.pdf", "photo_evidence.jpg", "police_report.pdf"]}, "metadata": {"source": "dashboard"}}'::jsonb)
ON CONFLICT (workflow_type) DO NOTHING;

-- Assign roles so escalations are visible to the right people
INSERT INTO lt_config_roles (workflow_type, role)
SELECT wt, unnest(ARRAY['reviewer', 'engineer', 'admin'])
FROM unnest(ARRAY['processClaim', 'processClaimOrchestrator']) AS wt
ON CONFLICT (workflow_type, role) DO NOTHING;

-- Resolver schema for the processClaim leaf (template for the dashboard resolve form).
-- The _lt field enables triage routing: set needsTriage=true and hint to a known
-- remediation keyword (image_orientation, wrong_language) to trigger MCP triage.
UPDATE lt_config_workflows SET resolver_schema = '{
  "approved": true,
  "analysis": {"confidence": 0.92, "flags": [], "summary": "Documents reviewed and verified."},
  "status": "resolved",
  "_lt": {"needsTriage": true, "hint": "image_orientation"}
}'::jsonb
WHERE workflow_type = 'processClaim' AND resolver_schema IS NULL;
