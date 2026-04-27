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

-- ─── Example workflows (all directly invocable) ────────────────────────────

INSERT INTO lt_config_workflows
  (workflow_type, task_queue, default_role, invocable, description, tool_tags, envelope_schema, resolver_schema)
VALUES
  -- Review content
  ('reviewContent', 'long-tail-examples', 'reviewer', true,
   'Content review — AI-powered moderation with human escalation for low-confidence results',
   ARRAY['document-processing', 'vision', 'ocr', 'translation'],
   '{"data": {"contentId": "article-001", "content": "Content to review...", "contentType": "article"}, "metadata": {"source": "dashboard"}}'::jsonb,
   '{"approved": true, "analysis": {"confidence": 0.95, "flags": [], "summary": "Manually reviewed and approved."}}'::jsonb),

  -- Verify document
  ('verifyDocument', 'long-tail-examples', 'reviewer', true,
   'Document verification — AI Vision analyzes identity documents',
   ARRAY['document-processing', 'vision', 'ocr', 'translation'],
   '{"data": {"documentId": "doc-001", "documentUrl": "https://example.com/doc.jpg", "documentType": "drivers_license", "memberId": "member-12345"}, "metadata": {"source": "dashboard"}}'::jsonb,
   '{"memberId": "", "extractedInfo": {}, "validationResult": "match", "confidence": 1.0}'::jsonb),

  -- Process claim
  ('processClaim', 'long-tail-examples', 'reviewer', true,
   'Insurance claim processing — document analysis, validation, and human review',
   ARRAY['document-processing', 'vision', 'database', 'query'],
   '{"data": {"claimId": "CLM-2024-001", "claimantId": "POL-5551234", "claimType": "auto_collision", "amount": 12500, "documents": ["incident_report.pdf", "photo_evidence.jpg"]}, "metadata": {"source": "dashboard"}}'::jsonb,
   '{"approved": true, "analysis": {"confidence": 0.92, "flags": [], "summary": "Documents reviewed and verified."}, "status": "resolved"}'::jsonb),

  -- Kitchen sink
  ('kitchenSink', 'long-tail-examples', 'reviewer', true,
   'Kitchen sink — demonstrates sleep, signals, parallel activities, escalation, and every durable primitive',
   '{}',
   '{"data": {"name": "World", "mode": "full"}, "metadata": {"source": "dashboard"}}'::jsonb,
   NULL),

  -- Basic signal (configured, NOT certified — no escalation roles)
  ('basicSignal', 'long-tail-examples', 'reviewer', true,
   'Signal-based escalation — workflow stays running while waiting for human input via conditionLT',
   '{}',
   '{"data": {"message": "Deployment approval needed for v2.1.0", "role": "reviewer"}, "metadata": {"certified": false, "source": "dashboard"}}'::jsonb,
   '{"properties": {"approved": {"type": "boolean", "default": false, "description": "Approve this deployment?"}, "notes": {"type": "string", "default": "", "description": "Reviewer notes — visible to the workflow author"}}}'::jsonb)
ON CONFLICT (workflow_type) DO NOTHING;

-- ─── Assign roles to all workflows ──────────────────────────────────────────

INSERT INTO lt_config_roles (workflow_type, role)
SELECT workflow_type, unnest(ARRAY['reviewer', 'engineer', 'admin'])
FROM lt_config_workflows
WHERE workflow_type != 'basicSignal'
ON CONFLICT (workflow_type, role) DO NOTHING;

