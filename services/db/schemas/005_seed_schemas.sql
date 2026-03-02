-- Seed envelope_schema and resolver_schema for example workflows.
-- Uses WHERE ... IS NULL so user edits are not overwritten on restart.

-- ── Envelope schemas (orchestrators — invocable entry points) ─────────────────

UPDATE lt_config_workflows SET envelope_schema = '{
  "data": {"contentId": "article-001", "content": "Content to review...", "contentType": "article"},
  "metadata": {"source": "dashboard"}
}'::jsonb
WHERE workflow_type = 'reviewContentOrchestrator' AND envelope_schema IS NULL;

UPDATE lt_config_workflows SET envelope_schema = '{
  "data": {"documentId": "doc-001", "documentUrl": "https://example.com/doc.jpg", "documentType": "drivers_license", "memberId": "member-12345"},
  "metadata": {"source": "dashboard"}
}'::jsonb
WHERE workflow_type = 'verifyDocumentOrchestrator' AND envelope_schema IS NULL;

UPDATE lt_config_workflows SET envelope_schema = '{
  "data": {"documentId": "doc-001", "documentUrl": "https://example.com/doc.jpg", "documentType": "drivers_license", "memberId": "member-12345"},
  "metadata": {"source": "dashboard"}
}'::jsonb
WHERE workflow_type = 'verifyDocumentMcpOrchestrator' AND envelope_schema IS NULL;

-- ── Resolver schemas (leaf workflows — create escalations) ────────────────────

UPDATE lt_config_workflows SET resolver_schema = '{
  "approved": true,
  "analysis": {"confidence": 0.95, "flags": [], "summary": "Manually reviewed and approved."}
}'::jsonb
WHERE workflow_type = 'reviewContent' AND resolver_schema IS NULL;

UPDATE lt_config_workflows SET resolver_schema = '{
  "memberId": "",
  "extractedInfo": {},
  "validationResult": "match",
  "confidence": 1.0
}'::jsonb
WHERE workflow_type = 'verifyDocument' AND resolver_schema IS NULL;

UPDATE lt_config_workflows SET resolver_schema = '{
  "memberId": "",
  "extractedInfo": {},
  "validationResult": "match",
  "confidence": 1.0
}'::jsonb
WHERE workflow_type = 'verifyDocumentMcp' AND resolver_schema IS NULL;

-- ── Kitchen sink workflow ─────────────────────────────────────────────────────

INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, invocable, description, envelope_schema)
VALUES
  ('kitchenSink', true, false, 'lt-kitchen-sink', 'reviewer', 'default', false,
   'Kitchen sink leaf — demonstrates sleep, signals, parallel activities, and more', NULL),
  ('kitchenSinkOrchestrator', true, true, 'lt-kitchen-sink-orch', 'reviewer', 'default', true,
   'Kitchen sink — showcases every Durable primitive',
   '{"data": {"name": "World", "mode": "full"}, "metadata": {"source": "dashboard"}}'::jsonb)
ON CONFLICT (workflow_type) DO NOTHING;

INSERT INTO lt_config_roles (workflow_type, role)
SELECT wt, unnest(ARRAY['reviewer', 'engineer', 'admin'])
FROM unnest(ARRAY['kitchenSink', 'kitchenSinkOrchestrator']) AS wt
ON CONFLICT (workflow_type, role) DO NOTHING;
