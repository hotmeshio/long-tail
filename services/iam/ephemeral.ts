import { getPool } from '../db';
import { encrypt, decrypt } from '../oauth/crypto';
import { loggerRegistry } from '../logger';

// ── Token format ────────────────────────────────────────────────────────────
// Opaque string: eph:v1:<label>:<uuid>
// The LLM passes these through as-is. Exchange happens inside activity bodies.

const EPH_PREFIX = 'eph:v1:';
const EPH_REGEX = /^eph:v1:([a-z_][a-z0-9_]*):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function formatEphemeralToken(uuid: string, label: string): string {
  return `${EPH_PREFIX}${label}:${uuid}`;
}

export function isEphemeralToken(value: string): boolean {
  return typeof value === 'string' && value.startsWith(EPH_PREFIX);
}

export function parseEphemeralToken(value: string): { label: string; uuid: string } | null {
  const match = value.match(EPH_REGEX);
  if (!match) return null;
  return { label: match[1], uuid: match[2] };
}

/**
 * Parse a token string and exchange the UUID for the decrypted value.
 * Returns null if the token format is invalid, expired, or uses exhausted.
 */
export async function exchangeEphemeralToken(tokenString: string): Promise<string | null> {
  const parsed = parseEphemeralToken(tokenString);
  if (!parsed) return null;
  return exchangeEphemeral(parsed.uuid);
}

/**
 * Deep-traverse a JSON value, replacing any string matching the eph:v1: format
 * with the exchanged plaintext. Non-matching values pass through unchanged.
 */
export async function exchangeTokensInArgs(obj: any): Promise<any> {
  if (typeof obj === 'string') {
    if (!isEphemeralToken(obj)) return obj;
    const plaintext = await exchangeEphemeralToken(obj);
    if (plaintext !== null) return plaintext;
    loggerRegistry.warn(`[ephemeral] token exchange failed: ${obj.slice(0, 40)}...`);
    return obj;
  }
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(exchangeTokensInArgs));
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = await exchangeTokensInArgs(v);
    }
    return result;
  }
  return obj;
}

// ── Core store/exchange ─────────────────────────────────────────────────────

export interface StoreEphemeralOptions {
  /** Max number of exchanges. 0 = unlimited. Default: 0 */
  maxUses?: number;
  /** TTL in seconds. Null/0 = no expiry. Default: null */
  ttlSeconds?: number;
  /** Human-readable label for debugging. */
  label?: string;
}

/**
 * Store a sensitive value. Returns the raw token UUID.
 * The value is encrypted at rest using AES-256-GCM.
 *
 * - maxUses: 0 (default) = unlimited exchanges until expired/revoked
 * - ttlSeconds: null (default) = no time-based expiry
 * - Both can be combined: e.g., maxUses=10, ttlSeconds=900
 */
export async function storeEphemeral(
  value: string,
  opts: StoreEphemeralOptions = {},
): Promise<string> {
  const pool = getPool();
  const encrypted = encrypt(value);
  const maxUses = opts.maxUses ?? 0;
  const expiresAt = opts.ttlSeconds
    ? `NOW() + ${opts.ttlSeconds} * INTERVAL '1 second'`
    : 'NULL';

  const { rows } = await pool.query(
    `INSERT INTO lt_ephemeral_credentials (value, label, max_uses, expires_at)
     VALUES ($1, $2, $3, ${expiresAt})
     RETURNING token`,
    [Buffer.from(encrypted, 'base64'), opts.label || null, maxUses],
  );
  return rows[0].token;
}

/**
 * Exchange a raw UUID token for the decrypted value.
 *
 * - If max_uses > 0: increments use_count, returns null when exhausted
 * - If max_uses = 0: unlimited (never blocked by count)
 * - If expires_at is set: returns null after expiry
 * - Row is deleted when use_count reaches max_uses (if max_uses > 0)
 */
export async function exchangeEphemeral(token: string): Promise<string | null> {
  const pool = getPool();

  // Atomic increment + check in one query.
  // Returns the row if the exchange is valid, nothing if expired/exhausted.
  const { rows } = await pool.query(
    `UPDATE lt_ephemeral_credentials
     SET use_count = use_count + 1
     WHERE token = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (max_uses = 0 OR use_count < max_uses)
     RETURNING value, use_count, max_uses`,
    [token],
  );

  if (rows.length === 0) return null;

  const { value: buf, use_count, max_uses } = rows[0];

  // Auto-delete when max_uses is reached (if bounded)
  if (max_uses > 0 && use_count >= max_uses) {
    await pool.query(
      `DELETE FROM lt_ephemeral_credentials WHERE token = $1`,
      [token],
    );
  }

  return decrypt((buf as Buffer).toString('base64'));
}

/**
 * Explicitly revoke a token before expiry/exhaustion.
 */
export async function revokeEphemeral(token: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM lt_ephemeral_credentials WHERE token = $1`,
    [token],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Clean up expired tokens. Returns the number of rows deleted.
 */
export async function cleanupExpired(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM lt_ephemeral_credentials
     WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
  );
  return rowCount ?? 0;
}
