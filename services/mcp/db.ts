import { getPool } from '../db';
import type { LTMcpServerRecord, LTMcpServerStatus, LTMcpToolManifest } from '../../types';

export interface CreateMcpServerInput {
  name: string;
  description?: string;
  transport_type: 'stdio' | 'sse';
  transport_config: Record<string, any>;
  auto_connect?: boolean;
  metadata?: Record<string, any>;
}

export async function createMcpServer(
  input: CreateMcpServerInput,
): Promise<LTMcpServerRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO lt_mcp_servers
       (name, description, transport_type, transport_config, auto_connect, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.name,
      input.description || null,
      input.transport_type,
      JSON.stringify(input.transport_config),
      input.auto_connect ?? false,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return rows[0];
}

export async function getMcpServer(id: string): Promise<LTMcpServerRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_mcp_servers WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

export async function getMcpServerByName(name: string): Promise<LTMcpServerRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_mcp_servers WHERE name = $1',
    [name],
  );
  return rows[0] || null;
}

export async function updateMcpServer(
  id: string,
  updates: Partial<Pick<CreateMcpServerInput, 'name' | 'description' | 'transport_type' | 'transport_config' | 'auto_connect' | 'metadata'>>,
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
  const { rowCount } = await pool.query(
    'DELETE FROM lt_mcp_servers WHERE id = $1',
    [id],
  );
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
      `UPDATE lt_mcp_servers
       SET status = $2, last_connected_at = NOW(), tool_manifest = $3
       WHERE id = $1`,
      [id, status, toolManifest ? JSON.stringify(toolManifest) : null],
    );
  } else {
    await pool.query(
      'UPDATE lt_mcp_servers SET status = $2 WHERE id = $1',
      [id, status],
    );
  }
}

export async function listMcpServers(filters: {
  status?: LTMcpServerStatus;
  auto_connect?: boolean;
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
  const { rows } = await pool.query(
    'SELECT * FROM lt_mcp_servers WHERE auto_connect = true ORDER BY name',
  );
  return rows;
}
