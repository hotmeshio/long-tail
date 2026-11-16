import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { KEY_LAST_USED_STAMP_SECONDS } from '../../modules/defaults';
import type { ServiceTokenRecord } from '../../types/delegation';
import { createDigestAdopter } from './digest-adoption';
import { digestKey } from './key-digest';
import {
  INSERT_SERVICE_TOKEN,
  GET_LIVE_SERVICE_TOKEN,
  GET_SERVICE_TOKENS_WITHOUT_DIGEST,
  SET_SERVICE_TOKEN_DIGEST,
  STAMP_SERVICE_TOKEN_LAST_USED,
  DELETE_SERVICE_TOKEN,
  LIST_SERVICE_TOKENS_BY_SERVER,
} from './sql';

const TOKEN_PREFIX = 'lt_svc_';

const adoptDigest = createDigestAdopter({
  async listWithoutDigest() {
    return (await (await getPool()).query(GET_SERVICE_TOKENS_WITHOUT_DIGEST)).rows;
  },
  async setDigest(id, digest) {
    await (await getPool()).query(SET_SERVICE_TOKEN_DIGEST, [id, digest]);
  },
});

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
    name, tokenHash, digestKey(rawToken), serverId, scopes, expiresAt || null,
  ]);
  return { id: rows[0].id, rawToken };
}

/**
 * Validate a raw service token: one indexed read by its digest. Returns the
 * record if the token is unexpired, null otherwise.
 */
export async function validateServiceToken(
  rawToken: string,
): Promise<ServiceTokenRecord | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  const pool = await getPool();
  const digest = digestKey(rawToken);

  let row = await readLiveServiceToken(digest);
  if (!row && (await adoptDigest(rawToken, digest))) {
    row = await readLiveServiceToken(digest);
  }
  if (!row) return null;

  const { stamp_due, ...record } = row;
  if (stamp_due) {
    pool.query(STAMP_SERVICE_TOKEN_LAST_USED, [record.id, KEY_LAST_USED_STAMP_SECONDS])
      .catch((err) => loggerRegistry.warn(`[lt-auth] service token last-used stamp failed: ${err?.message}`));
  }
  return record;
}

async function readLiveServiceToken(
  digest: string,
): Promise<(ServiceTokenRecord & { stamp_due: boolean }) | null> {
  const pool = await getPool();
  const { rows } = await pool.query(GET_LIVE_SERVICE_TOKEN, [digest, KEY_LAST_USED_STAMP_SECONDS]);
  return rows[0] ?? null;
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
