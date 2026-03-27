import jwt from 'jsonwebtoken';

import { config } from '../../modules/config';
import type { DelegationTokenPayload } from '../../types/delegation';

const MAX_TTL_SECONDS = 3600; // 1 hour
const DEFAULT_TTL_SECONDS = 300; // 5 minutes

/**
 * Create a scoped, short-lived delegation token.
 *
 * Delegation tokens authorize MCP tools to act on behalf of a user
 * with only the specified scopes.
 */
export function createDelegationToken(
  userId: string,
  scopes: string[],
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  options?: { workflowId?: string; serverId?: string },
): string {
  const ttl = Math.min(Math.max(ttlSeconds, 1), MAX_TTL_SECONDS);
  const payload: Omit<DelegationTokenPayload, 'iss' | 'iat' | 'exp'> = {
    type: 'delegation',
    sub: userId,
    scopes,
    workflowId: options?.workflowId,
    serverId: options?.serverId,
  };
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: ttl,
    issuer: 'long-tail',
  } as jwt.SignOptions);
}

/**
 * Validate a delegation token. Returns the decoded payload or throws.
 */
export function validateDelegationToken(token: string): DelegationTokenPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, {
    issuer: 'long-tail',
  }) as DelegationTokenPayload;
  if (decoded.type !== 'delegation') {
    throw new Error('Token is not a delegation token');
  }
  return decoded;
}

/**
 * Check that a delegation token has the required scope.
 * Throws if the scope is missing.
 */
export function requireScope(
  payload: DelegationTokenPayload,
  requiredScope: string,
): void {
  if (!payload.scopes.includes(requiredScope)) {
    throw new Error(`Delegation token missing required scope: ${requiredScope}`);
  }
}
