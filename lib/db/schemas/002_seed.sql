-- System seed data: escalation chains.
-- Workflow configs and MCP server definitions are seeded at startup
-- via inline config on worker and factory declarations.

-- ─── Escalation chains ─────────────────────────────────────────────────────

INSERT INTO lt_config_role_escalations (source_role, target_role) VALUES
  ('reviewer',  'engineer'),
  ('reviewer',  'admin'),
  ('engineer',  'admin'),
  ('engineer',  'superadmin'),
  ('admin',     'engineer'),
  ('admin',     'superadmin')
ON CONFLICT DO NOTHING;
