import { getPool } from '../../lib/db';
import type { LTMcpServerRecord, LTMcpServerStatus, LTMcpToolManifest } from '../../types';
import { loggerRegistry } from '../../lib/logger';
import {
  CREATE_MCP_SERVER,
  SEED_MCP_SERVER,
  GET_MCP_SERVER,
  GET_MCP_SERVER_BY_NAME,
  DELETE_MCP_SERVER,
  UPDATE_STATUS_CONNECTED,
  UPDATE_STATUS,
  GET_AUTO_CONNECT_SERVERS,
  DELETE_STALE_BUILTIN_SERVERS,
} from './sql';

import type { CreateMcpServerInput } from './types';

export async function createMcpServer(
  input: CreateMcpServerInput,
): Promise<LTMcpServerRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    CREATE_MCP_SERVER,
    [
      input.name,
      input.description || null,
      input.transport_type,
      JSON.stringify(input.transport_config),
      input.auto_connect ?? false,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.tags || [],
      input.compile_hints || null,
      input.credential_providers || [],
    ],
  );
  return rows[0];
}

export async function getMcpServer(id: string): Promise<LTMcpServerRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_MCP_SERVER, [id]);
  return rows[0] || null;
}

export async function getMcpServerByName(name: string): Promise<LTMcpServerRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_MCP_SERVER_BY_NAME, [name],
  );
  return rows[0] || null;
}

export async function updateMcpServer(
  id: string,
  updates: Partial<Pick<CreateMcpServerInput, 'name' | 'description' | 'transport_type' | 'transport_config' | 'auto_connect' | 'metadata' | 'tags' | 'compile_hints' | 'credential_providers'>>,
): Promise<LTMcpServerRecord | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(updates.description);
  }
  if (updates.transport_type !== undefined) {
    sets.push(`transport_type = $${idx++}`);
    values.push(updates.transport_type);
  }
  if (updates.transport_config !== undefined) {
    sets.push(`transport_config = $${idx++}`);
    values.push(JSON.stringify(updates.transport_config));
  }
  if (updates.auto_connect !== undefined) {
    sets.push(`auto_connect = $${idx++}`);
    values.push(updates.auto_connect);
  }
  if (updates.metadata !== undefined) {
    sets.push(`metadata = $${idx++}`);
    values.push(JSON.stringify(updates.metadata));
  }
  if (updates.tags !== undefined) {
    sets.push(`tags = $${idx++}`);
    values.push(updates.tags);
  }
  if (updates.compile_hints !== undefined) {
    sets.push(`compile_hints = $${idx++}`);
    values.push(updates.compile_hints || null);
  }
  if (updates.credential_providers !== undefined) {
    sets.push(`credential_providers = $${idx++}`);
    values.push(updates.credential_providers);
  }

  if (sets.length === 0) return getMcpServer(id);

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE lt_mcp_servers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_MCP_SERVER, [id]);
  return (rowCount || 0) > 0;
}

export async function updateMcpServerStatus(
  id: string,
  status: LTMcpServerStatus,
  toolManifest?: LTMcpToolManifest[],
): Promise<void> {
  const pool = getPool();
  if (status === 'connected') {
    await pool.query(
      UPDATE_STATUS_CONNECTED,
      [id, status, toolManifest ? JSON.stringify(toolManifest) : null],
    );
  } else {
    await pool.query(UPDATE_STATUS, [id, status]);
  }
}

export async function listMcpServers(filters: {
  status?: LTMcpServerStatus;
  auto_connect?: boolean;
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}): Promise<{ servers: LTMcpServerRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.auto_connect !== undefined) {
    conditions.push(`auto_connect = $${idx++}`);
    values.push(filters.auto_connect);
  }
  if (filters.search) {
    conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx} OR tool_manifest::text ILIKE $${idx})`);
    values.push(`%${filters.search}%`);
    idx++;
  }
  if (filters.tags?.length) {
    conditions.push(`tags && $${idx++}::text[]`);
    values.push(filters.tags);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_mcp_servers ${where}`, values),
    pool.query(
      `SELECT * FROM lt_mcp_servers ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    servers: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function getAutoConnectServers(): Promise<LTMcpServerRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_AUTO_CONNECT_SERVERS);
  return rows;
}

/**
 * Find MCP servers by tags.
 * @param tags - Tags to filter by
 * @param match - 'any' (OR — server has at least one tag) or 'all' (AND — server has all tags)
 */
export async function findServersByTags(
  tags: string[],
  match: 'any' | 'all' = 'any',
): Promise<LTMcpServerRecord[]> {
  if (!tags.length) return [];
  const pool = getPool();
  const operator = match === 'all' ? '@>' : '&&';
  const { rows } = await pool.query(
    `SELECT * FROM lt_mcp_servers WHERE tags ${operator} $1::text[] ORDER BY name`,
    [tags],
  );
  return rows;
}

/**
 * Seed an MCP server at startup (insert-if-absent).
 * DB is the source of truth — if the row already exists, log drift warnings
 * but do not overwrite. Returns true if inserted, false if already existed.
 */
export async function seedMcpServer(input: {
  name: string;
  description?: string;
  tags?: string[];
  compileHints?: string;
  credentialProviders?: string[];
  toolManifest?: any[];
}): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(SEED_MCP_SERVER, [
    input.name,
    input.description || null,
    'stdio',
    JSON.stringify({ builtin: true, process: 'in-memory' }),
    JSON.stringify(input.toolManifest || []),
    JSON.stringify({ builtin: true }),
    input.tags || [],
    input.compileHints || null,
    input.credentialProviders || [],
  ]);

  const inserted = (rowCount ?? 0) > 0;

  if (!inserted) {
    // Drift detection
    const existing = await getMcpServerByName(input.name);
    if (existing) {
      const drifts: string[] = [];
      if (input.description && existing.description !== input.description) drifts.push('description');
      if (input.compileHints && existing.compile_hints !== input.compileHints) drifts.push('compile_hints');
      if (JSON.stringify(input.tags || []) !== JSON.stringify(existing.tags || [])) drifts.push('tags');
      if (drifts.length) {
        loggerRegistry.warn(`[long-tail] MCP server drift: ${input.name} — ${drifts.join(', ')} differ between code and DB`);
      }
    }
  }

  return inserted;
}

/**
 * Remove builtin MCP servers that are no longer declared in factory config.
 */
export async function cleanStaleBuiltinServers(activeNames: string[]): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(DELETE_STALE_BUILTIN_SERVERS, [activeNames]);
  for (const row of rows) {
    loggerRegistry.info(`[long-tail] removed stale builtin MCP server: ${row.name}`);
  }
}
