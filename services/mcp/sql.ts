// ─── MCP server CRUD ────────────────────────────────────────────────────────

export const CREATE_MCP_SERVER = `
  INSERT INTO lt_mcp_servers
    (name, description, transport_type, transport_config, auto_connect, metadata, tags)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *`;

export const GET_MCP_SERVER = `
  SELECT * FROM lt_mcp_servers WHERE id = $1`;

export const GET_MCP_SERVER_BY_NAME = `
  SELECT * FROM lt_mcp_servers WHERE name = $1`;

export const DELETE_MCP_SERVER = `
  DELETE FROM lt_mcp_servers WHERE id = $1`;

// ─── Status updates ─────────────────────────────────────────────────────────

export const UPDATE_STATUS_CONNECTED = `
  UPDATE lt_mcp_servers
  SET status = $2, last_connected_at = NOW(), tool_manifest = $3
  WHERE id = $1`;

export const UPDATE_STATUS = `
  UPDATE lt_mcp_servers SET status = $2 WHERE id = $1`;

// ─── Discovery ──────────────────────────────────────────────────────────────

export const GET_AUTO_CONNECT_SERVERS = `
  SELECT * FROM lt_mcp_servers
  WHERE auto_connect = true
  ORDER BY name`;

// ─── System health (used by db-server.ts) ───────────────────────────────────

export const HEALTH_TASK_COUNTS = `
  SELECT status, COUNT(*)::int AS count
  FROM lt_tasks GROUP BY status ORDER BY status`;

export const HEALTH_ESCALATION_COUNTS = `
  SELECT status, COUNT(*)::int AS count
  FROM lt_escalations GROUP BY status ORDER BY status`;

export const HEALTH_ACTIVE_WORKFLOW_TYPES = `
  SELECT DISTINCT workflow_type FROM lt_tasks
  WHERE status IN ('pending', 'in_progress')
  ORDER BY workflow_type`;

export const HEALTH_RECENT_ACTIVITY = `
  SELECT
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS tasks_created_1h,
    COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '1 hour')::int AS tasks_completed_1h,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS tasks_created_24h,
    COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '24 hours')::int AS tasks_completed_24h
  FROM lt_tasks`;

// ─── Seed (used by system/seed.ts) ──────────────────────────────────────────

export const SEED_MCP_SERVER = `
  INSERT INTO lt_mcp_servers
    (name, description, transport_type, transport_config, auto_connect, status, tool_manifest, metadata, tags, compile_hints, last_connected_at)
  VALUES ($1, $2, $3, $4, true, 'connected', $5, $6, $7, $8, NOW())
  ON CONFLICT (name) DO UPDATE SET
    tool_manifest = EXCLUDED.tool_manifest,
    metadata = EXCLUDED.metadata,
    description = EXCLUDED.description,
    tags = EXCLUDED.tags,
    compile_hints = EXCLUDED.compile_hints,
    status = 'connected',
    last_connected_at = NOW()`;
