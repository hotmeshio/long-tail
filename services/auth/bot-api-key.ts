import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { getPool } from '../../lib/db';
import {
  INSERT_BOT_KEY,
  GET_ALL_ACTIVE_BOT_KEYS,
  UPDATE_BOT_KEY_LAST_USED,
  DELETE_BOT_KEY,
  LIST_BOT_KEYS_BY_USER,
} from './sql';

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
  const { rows } = await pool.query(INSERT_BOT_KEY, [
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
  const { rows } = await pool.query(GET_ALL_ACTIVE_BOT_KEYS);
  for (const row of rows) {
    if (await bcrypt.compare(rawKey, row.key_hash)) {
      await pool.query(UPDATE_BOT_KEY_LAST_USED, [row.id]);
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
  const result = await pool.query(DELETE_BOT_KEY, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * List API keys for a bot account (without hashes).
 */
export async function listBotApiKeys(userId: string): Promise<BotApiKeyRecord[]> {
  const pool = await getPool();
  const { rows } = await pool.query(LIST_BOT_KEYS_BY_USER, [userId]);
  return rows;
}
