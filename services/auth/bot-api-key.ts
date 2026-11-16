import * as crypto from 'crypto';
import { isUuid } from '../../lib/uuid';
import bcrypt from 'bcryptjs';

import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { KEY_LAST_USED_STAMP_SECONDS } from '../../modules/defaults';
import type { LTRoleType } from '../../types';
import { createDigestAdopter } from './digest-adoption';
import { digestKey } from './key-digest';
import {
  INSERT_BOT_KEY,
  GET_LIVE_BOT_KEY,
  GET_BOT_KEYS_WITHOUT_DIGEST,
  SET_BOT_KEY_DIGEST,
  STAMP_BOT_KEY_LAST_USED,
  DELETE_BOT_KEY,
  LIST_BOT_KEYS_BY_USER,
  GET_BOT_KEY_OWNER,
} from './sql';

const TOKEN_PREFIX = 'lt_bot_';
const KEY_SHAPE = /^lt_bot_[0-9a-f]{64}$/;

const adoptDigest = createDigestAdopter({
  async listWithoutDigest() {
    return (await (await getPool()).query(GET_BOT_KEYS_WITHOUT_DIGEST)).rows;
  },
  async setDigest(id, digest) {
    await (await getPool()).query(SET_BOT_KEY_DIGEST, [id, digest]);
  },
});

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

/** A presented key that is valid now, with its bot's current memberships. */
export interface LiveBotApiKey {
  id: string;
  name: string;
  user_id: string;
  scopes: string[];
  roles: { role: string; type: LTRoleType }[];
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
    name, userId, keyHash, digestKey(rawKey), scopes, expiresAt || null,
  ]);
  return { id: rows[0].id, rawKey };
}

/**
 * Validate a raw bot API key: one indexed read by its digest. The key must be
 * unexpired and its bot active. Returns null otherwise.
 */
export async function validateBotApiKey(
  rawKey: string,
): Promise<LiveBotApiKey | null> {
  if (!KEY_SHAPE.test(rawKey)) return null;
  const pool = await getPool();
  const digest = digestKey(rawKey);

  let row = await readLiveBotKey(digest);
  if (!row && (await adoptDigest(rawKey, digest))) {
    row = await readLiveBotKey(digest);
  }
  if (!row) return null;

  const { stamp_due, ...key } = row;
  if (stamp_due) {
    pool.query(STAMP_BOT_KEY_LAST_USED, [key.id, KEY_LAST_USED_STAMP_SECONDS])
      .catch((err) => loggerRegistry.warn(`[lt-auth] bot key last-used stamp failed: ${err?.message}`));
  }
  return key;
}

async function readLiveBotKey(
  digest: string,
): Promise<(LiveBotApiKey & { stamp_due: boolean }) | null> {
  const pool = await getPool();
  const { rows } = await pool.query(GET_LIVE_BOT_KEY, [digest, KEY_LAST_USED_STAMP_SECONDS]);
  return rows[0] ?? null;
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
/** The bot account a key belongs to, or null when there is no such key. */
export async function getBotApiKeyOwner(keyId: string): Promise<string | null> {
  if (!isUuid(keyId)) return null;
  const pool = await getPool();
  const { rows } = await pool.query(GET_BOT_KEY_OWNER, [keyId]);
  return rows[0]?.user_id ?? null;
}

export async function listBotApiKeys(userId: string): Promise<BotApiKeyRecord[]> {
  const pool = await getPool();
  const { rows } = await pool.query(LIST_BOT_KEYS_BY_USER, [userId]);
  return rows;
}
