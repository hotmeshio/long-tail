import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { getPool } from '../../lib/db';
import type { ServiceTokenRecord } from '../../types/delegation';
import {
  INSERT_SERVICE_TOKEN,
  GET_ALL_ACTIVE_SERVICE_TOKENS,
  UPDATE_SERVICE_TOKEN_LAST_USED,
  DELETE_SERVICE_TOKEN,
  LIST_SERVICE_TOKENS_BY_SERVER,
} from './sql';

const TOKEN_PREFIX = 'lt_svc_';

/**
 * Generate a new service token for an external MCP server.
 * Returns the raw token once — it is never stored in plaintext.
 */
export async function generateServiceToken(
  name: string,
  serverId: string | null,
  scopes: string[],
  expiresAt?: Date,
): Promise<{ id: string; rawToken: string }> {
  const rawToken = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const pool = await getPool();
  const { rows } = await pool.query(INSERT_SERVICE_TOKEN, [
    name, tokenHash, serverId, scopes, expiresAt || null,
  ]);
  return { id: rows[0].id, rawToken };
}

/**
 * Validate a raw service token. Returns the record if valid, null otherwise.
 */
export async function validateServiceToken(
  rawToken: string,
): Promise<(ServiceTokenRecord & { token_hash?: undefined }) | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  const pool = await getPool();
  const { rows } = await pool.query(GET_ALL_ACTIVE_SERVICE_TOKENS);
  for (const row of rows) {
    if (await bcrypt.compare(rawToken, row.token_hash)) {
      await pool.query(UPDATE_SERVICE_TOKEN_LAST_USED, [row.id]);
      const { token_hash, ...record } = row;
      return record;
    }
  }
  return null;
}

/**
 * Revoke (delete) a service token by ID.
 */
export async function revokeServiceToken(id: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.query(DELETE_SERVICE_TOKEN, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * List service tokens for an MCP server (without hashes).
 */
export async function listServiceTokens(serverId: string): Promise<ServiceTokenRecord[]> {
  const pool = await getPool();
  const { rows } = await pool.query(LIST_SERVICE_TOKENS_BY_SERVER, [serverId]);
  return rows;
}
