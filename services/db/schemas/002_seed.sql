-- Seed data: workflow configs, MCP servers, escalation chains.

-- ─── MCP servers ────────────────────────────────────────────────────────────

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

-- ─── System workflows ───────────────────────────────────────────────────────

INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, default_modality, invocable, description, tool_tags, envelope_schema)
VALUES
  ('mcpTriage', 'long-tail-system', 'engineer', 'default', false,
   'MCP triage — remediates stalled workflows using MCP tools and engineer guidance',
   '{}', NULL),
  ('mcpQuery', 'long-tail-system', 'engineer', 'default', true,
   'Do anything with tools — browser automation, file operations, HTTP requests, database queries, document processing, and more',
   '{}',
   '{"data": {"prompt": "Describe what you want to accomplish using available tools..."}, "metadata": {"source": "dashboard"}}'::jsonb),
  ('insightQuery', 'long-tail-system', 'admin', 'default', false,
   'AI-powered insight query — answers natural language questions about system state using DB tools',
   '{}', NULL)
ON CONFLICT (workflow_type) DO NOTHING;

-- ─── Example workflows ──────────────────────────────────────────────────────

INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, default_modality, invocable, description, tool_tags, envelope_schema, resolver_schema)
VALUES
  -- Review content
  ('reviewContent', 'long-tail-examples', 'reviewer', 'default', false,
   NULL,
   ARRAY['document-processing', 'vision', 'ocr', 'translation'],
   NULL,
   '{"approved": true, "analysis": {"confidence": 0.95, "flags": [], "summary": "Manually reviewed and approved."}}'::jsonb),
  ('reviewContentOrchestrator', 'long-tail-examples', 'reviewer', 'default', true,
   'Content review — AI-powered moderation with human escalation for low-confidence results',
   '{}',
   '{"data": {"contentId": "article-001", "content": "Content to review...", "contentType": "article"}, "metadata": {"source": "dashboard"}}'::jsonb,
   NULL),

  -- Verify document
  ('verifyDocument', 'long-tail-examples', 'reviewer', 'default', false,
   NULL,
   ARRAY['document-processing', 'vision', 'ocr', 'translation'],
   NULL,
   '{"memberId": "", "extractedInfo": {}, "validationResult": "match", "confidence": 1.0}'::jsonb),
  ('verifyDocumentOrchestrator', 'long-tail-examples', 'reviewer', 'default', false,
   NULL, '{}',
   '{"data": {"documentId": "doc-001", "documentUrl": "https://example.com/doc.jpg", "documentType": "drivers_license", "memberId": "member-12345"}, "metadata": {"source": "dashboard"}}'::jsonb,
   NULL),

  -- Verify document MCP
  ('verifyDocumentMcp', 'long-tail-examples', 'reviewer', 'default', false,
   NULL,
   ARRAY['document-processing', 'vision', 'ocr', 'translation'],
   NULL,
   '{"memberId": "", "extractedInfo": {}, "validationResult": "match", "confidence": 1.0}'::jsonb),
  ('verifyDocumentMcpOrchestrator', 'long-tail-examples', 'reviewer', 'default', false,
   NULL, '{}',
   '{"data": {"documentId": "doc-001", "documentUrl": "https://example.com/doc.jpg", "documentType": "drivers_license", "memberId": "member-12345"}, "metadata": {"source": "dashboard"}}'::jsonb,
   NULL),

  -- Process claim
  ('processClaim', 'long-tail-examples', 'reviewer', 'default', false,
   'Process claim leaf — analyzes insurance claim documents and validates claims',
   ARRAY['document-processing', 'vision', 'database', 'query'],
   NULL,
   '{"approved": true, "analysis": {"confidence": 0.92, "flags": [], "summary": "Documents reviewed and verified."}, "status": "resolved", "_lt": {"needsTriage": true, "hint": "image_orientation"}}'::jsonb),
  ('processClaimOrchestrator', 'long-tail-examples', 'reviewer', 'default', true,
   'Insurance claim processing — document analysis, validation, and human review',
   '{}',
   '{"data": {"claimId": "CLM-2024-001", "claimantId": "POL-5551234", "claimType": "auto_collision", "amount": 12500, "documents": ["incident_report.pdf", "photo_evidence.jpg", "police_report.pdf"]}, "metadata": {"source": "dashboard"}}'::jsonb,
   NULL),

  -- Kitchen sink
  ('kitchenSink', 'long-tail-examples', 'reviewer', 'default', false,
   'Kitchen sink leaf — demonstrates sleep, signals, parallel activities, and more',
   '{}', NULL, NULL),
  ('kitchenSinkOrchestrator', 'long-tail-examples', 'reviewer', 'default', true,
   'Kitchen sink — demonstrates sleep, signals, parallel activities, escalation, and every durable primitive',
   '{}',
   '{"data": {"name": "World", "mode": "full"}, "metadata": {"source": "dashboard"}}'::jsonb,
   NULL)
ON CONFLICT (workflow_type) DO NOTHING;

-- ─── Assign roles to all workflows ──────────────────────────────────────────

INSERT INTO lt_config_roles (workflow_type, role)
SELECT workflow_type, unnest(ARRAY['reviewer', 'engineer', 'admin'])
FROM lt_config_workflows
ON CONFLICT (workflow_type, role) DO NOTHING;

-- insightQuery gets a different role set
INSERT INTO lt_config_roles (workflow_type, role)
SELECT 'insightQuery', unnest(ARRAY['superadmin'])
ON CONFLICT (workflow_type, role) DO NOTHING;
