import bcrypt from 'bcryptjs';

import { getPool } from '../../lib/db';
import type { LTUserRecord } from '../../types';

import { attachRoles } from './crud';
import { GET_USER_BY_EXTERNAL_ID } from './sql';

// ─── Password authentication ────────────────────────────────────────────────

/**
 * Verify a user's password. Returns the full user record (with roles)
 * on success, or null if the external_id doesn't exist, the user has
 * no password set, or the password doesn't match.
 */
export async function verifyPassword(
  externalId: string,
  password: string,
): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_BY_EXTERNAL_ID, [externalId]);
  if (!rows[0] || !rows[0].password_hash) return null;
  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return null;
  return attachRoles(rows[0]);
}
