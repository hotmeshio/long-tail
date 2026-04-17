import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { getPool } from '../../lib/db';

const TOKEN_PREFIX = 'lt_bot_';

/** Record returned from bot API key queries (never includes key_hash). */
export interface BotApiKeyRecord {
  id: string;
  name: string;
  user_id: string;
  scopes: string[];
  expires_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const INSERT_KEY = `
  INSERT INTO lt_bot_api_keys (name, user_id, key_hash, scopes, expires_at)
  VALUES ($1, $2, $3, $4, $5) RETURNING id`;

const GET_KEYS_BY_USER = `
  SELECT id, name, user_id, key_hash, scopes
  FROM lt_bot_api_keys
  WHERE user_id = $1
    AND (expires_at IS NULL OR expires_at > NOW())`;

const GET_ALL_ACTIVE_KEYS = `
  SELECT id, name, user_id, key_hash, scopes
  FROM lt_bot_api_keys
  WHERE (expires_at IS NULL OR expires_at > NOW())`;

const UPDATE_LAST_USED = `
  UPDATE lt_bot_api_keys SET last_used_at = NOW() WHERE id = $1`;

const DELETE_KEY = `
  DELETE FROM lt_bot_api_keys WHERE id = $1`;

const LIST_BY_USER = `
  SELECT id, name, user_id, scopes, expires_at, last_used_at, created_at, updated_at
  FROM lt_bot_api_keys WHERE user_id = $1 ORDER BY created_at`;

/**
 * Generate a new API key for a bot account.
 * Returns the raw key once — it is never stored in plaintext.
 */
export async function generateBotApiKey(
  name: string,
  userId: string,
  scopes: string[] = [],
  expiresAt?: Date,
): Promise<{ id: string; rawKey: string }> {
  const rawKey = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = await bcrypt.hash(rawKey, 10);
  const pool = await getPool();
  const { rows } = await pool.query(INSERT_KEY, [
    name, userId, keyHash, scopes, expiresAt || null,
  ]);
  return { id: rows[0].id, rawKey };
}

/**
 * Validate a raw bot API key.
 * Returns the key record (with user_id) if valid, null otherwise.
 */
export async function validateBotApiKey(
  rawKey: string,
): Promise<BotApiKeyRecord | null> {
  if (!rawKey.startsWith(TOKEN_PREFIX)) return null;
  const pool = await getPool();
  const { rows } = await pool.query(GET_ALL_ACTIVE_KEYS);
  for (const row of rows) {
    if (await bcrypt.compare(rawKey, row.key_hash)) {
      await pool.query(UPDATE_LAST_USED, [row.id]);
      const { key_hash, ...record } = row;
      return record;
    }
  }
  return null;
}

/**
 * Revoke (delete) a bot API key by ID.
 */
export async function revokeBotApiKey(id: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.query(DELETE_KEY, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * List API keys for a bot account (without hashes).
 */
export async function listBotApiKeys(userId: string): Promise<BotApiKeyRecord[]> {
  const pool = await getPool();
  const { rows } = await pool.query(LIST_BY_USER, [userId]);
  return rows;
}
