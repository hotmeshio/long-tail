import * as crypto from 'crypto';

import { getPool } from '../../../lib/db';
import { isUuid } from '../../../lib/uuid';
import type { LTGrantPolicy, LTGrantSnapshot, LTGrantSummary, LTOAuthClient } from '../../../types/oauth-server';
import {
  INSERT_CLIENT,
  GET_CLIENT,
  ISSUE_CODE,
  EXCHANGE_CODE,
  ROTATE_REFRESH_TOKEN,
  GET_LIVE_GRANT,
  REVOKE_ON_REFRESH_REUSE,
  REVOKE_BY_REFRESH_TOKEN,
  REVOKE_GRANT,
  LIST_GRANTS,
} from './sql';

/** A refresh token reused within this many seconds is treated as a client retry. */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

export interface RevokedGrant {
  grant_id: string;
  user_id: string;
}

/** A new random secret: 32 bytes, base64url. */
export function createSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 of a secret. Codes and refresh tokens are stored only as hashes. */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** The PKCE S256 challenge for a code verifier (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export async function registerClient(input: { clientName?: string; redirectUris: string[] }): Promise<LTOAuthClient> {
  const { rows } = await getPool().query(INSERT_CLIENT, [
    `ltc_${createSecret()}`, input.clientName ?? null, input.redirectUris,
  ]);
  return rows[0];
}

/** A client id as registerClient issues it; anything else names no client and never reaches SQL. */
const CLIENT_ID = /^ltc_[A-Za-z0-9_-]{43}$/;
export const isClientId = (value: string): boolean => CLIENT_ID.test(value);

export async function getClient(clientId: string): Promise<LTOAuthClient | null> {
  if (!isClientId(clientId)) return null;
  const { rows } = await getPool().query(GET_CLIENT, [clientId]);
  return rows[0] ?? null;
}

/** Record the person's consent as a grant and return a one-time code for it. */
export async function issueAuthorizationCode(input: {
  userId: string;
  clientId: string;
  policy: LTGrantPolicy;
  scope: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: string;
  ttlSeconds: number;
}): Promise<{ code: string; grantId: string }> {
  if (!isUuid(input.userId)) throw new Error('issueAuthorizationCode: userId must be a UUID');
  const code = createSecret();
  const { rows } = await getPool().query(ISSUE_CODE, [
    input.userId, input.clientId, input.policy, input.scope,
    hashSecret(code), input.redirectUri, input.codeChallenge, input.resource ?? null, input.ttlSeconds,
  ]);
  return { code, grantId: rows[0].grant_id };
}

/**
 * Exchange a code for the grant and its first refresh token. Null when the
 * code is unknown, used, expired, for another client or redirect URI, fails
 * PKCE, or its grant or owner is no longer active.
 */
export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  refreshTtlSeconds: number;
}): Promise<{ snapshot: LTGrantSnapshot; resource: string | null; refreshToken: string } | null> {
  const refreshToken = createSecret();
  const { rows } = await getPool().query(EXCHANGE_CODE, [
    hashSecret(input.code), input.clientId, input.redirectUri, pkceChallenge(input.codeVerifier),
    hashSecret(refreshToken), input.refreshTtlSeconds,
  ]);
  if (!rows[0]) return null;
  const { resource, ...snapshot } = rows[0];
  return { snapshot, resource, refreshToken };
}

/**
 * Rotate a refresh token for the client that holds it. Null when it is
 * unknown, used, expired, another client's, or its grant or owner is no
 * longer active. A used token presented again outside the
 * grace window revokes its grant, and `revoked` reports it.
 */
export async function rotateRefreshToken(input: {
  refreshToken: string;
  clientId: string;
  refreshTtlSeconds: number;
}): Promise<{ snapshot: LTGrantSnapshot; refreshToken: string } | { snapshot: null; revoked: RevokedGrant | null }> {
  const pool = getPool();
  const next = createSecret();
  const oldHash = hashSecret(input.refreshToken);
  const { rows } = await pool.query(ROTATE_REFRESH_TOKEN, [oldHash, hashSecret(next), input.refreshTtlSeconds, input.clientId]);
  if (rows[0]) return { snapshot: rows[0], refreshToken: next };
  const reuse = await pool.query(REVOKE_ON_REFRESH_REUSE, [oldHash, REFRESH_REUSE_GRACE_SECONDS]);
  return { snapshot: null, revoked: reuse.rows[0] ?? null };
}

/** The live grant an access token names; null when it is revoked, its owner inactive, or it is another user's. */
export async function getLiveGrant(grantId: string, userId: string): Promise<LTGrantSnapshot | null> {
  if (!isUuid(grantId) || !isUuid(userId)) return null;
  const { rows } = await getPool().query(GET_LIVE_GRANT, [grantId, userId]);
  return rows[0] ?? null;
}

/** Revoke the grant behind a refresh token presented by its own client (RFC 7009). */
export async function revokeByRefreshToken(refreshToken: string, clientId: string): Promise<RevokedGrant | null> {
  const { rows } = await getPool().query(REVOKE_BY_REFRESH_TOKEN, [hashSecret(refreshToken), clientId]);
  return rows[0] ?? null;
}

/** Revoke a grant; with `userId`, only when it belongs to that user. */
export async function revokeGrant(grantId: string, userId?: string): Promise<RevokedGrant | null> {
  if (!isUuid(grantId) || (userId !== undefined && !isUuid(userId))) return null;
  const { rows } = await getPool().query(REVOKE_GRANT, [grantId, userId ?? null]);
  return rows[0] ?? null;
}

/** The person's live grants that a client has put to use. */
export async function listGrants(userId: string): Promise<LTGrantSummary[]> {
  if (!isUuid(userId)) return [];
  const { rows } = await getPool().query(LIST_GRANTS, [userId]);
  return rows;
}
