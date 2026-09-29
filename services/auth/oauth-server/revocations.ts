import { OAUTH_ACCESS_TOKEN_TTL_SECONDS } from '../../../modules/defaults';

/**
 * Grants and users whose access tokens must stop working before they expire.
 * Checked in memory on every /mcp request. An entry is kept for one access
 * token lifetime: after that, every token it could match has expired anyway,
 * and refresh consults the database.
 */

const revokedGrants = new Map<string, number>();
const revokedUsers = new Map<string, number>();

function prune(entries: Map<string, number>, now: number): void {
  for (const [id, until] of entries) if (until <= now) entries.delete(id);
}

export function markRevoked(target: { grantId?: string; userId?: string }, now: number = Date.now()): void {
  const until = now + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000;
  if (target.grantId) revokedGrants.set(target.grantId, until);
  if (target.userId) revokedUsers.set(target.userId, until);
}

export function isRevoked(claims: { gid: string; sub: string }, now: number = Date.now()): boolean {
  prune(revokedGrants, now);
  prune(revokedUsers, now);
  return revokedGrants.has(claims.gid) || revokedUsers.has(claims.sub);
}

/** Reset. Used by tests. */
export function clearRevocations(): void {
  revokedGrants.clear();
  revokedUsers.clear();
}
