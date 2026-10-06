import jwt from 'jsonwebtoken';

import { config } from '../../../modules/config';
import { OAUTH_ACCESS_TOKEN_TTL_SECONDS } from '../../../modules/defaults';
import type { AuthPayload, LTGrantPolicy, LTGrantRole, LTGrantSnapshot, LTRoleType } from '../../../types';
import { ACCESS_TOKEN_TYPE, OAUTH_PRINCIPAL_TYPE } from './constants';

/**
 * Access tokens are HS256 JWTs for one resource (`aud`, the `/mcp` URL). They
 * name the grant (`gid`) and the person (`sub`) and carry no `userId` claim,
 * so `requireAuth` refuses them on `/api`. A verified token is honored only
 * while its grant is live: `/mcp` reads the grant on each request and acts on
 * its current roles, policy and scope.
 */

export interface AccessTokenTarget {
  issuer: string;
  audience: string;
}

export interface LTAccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  client_id: string;
  gid: string;
  scope: string;
  policy: LTGrantPolicy;
  roles: LTGrantRole[];
  iat: number;
  exp: number;
}

export function signAccessToken(
  snapshot: LTGrantSnapshot,
  target: AccessTokenTarget,
  ttlSeconds: number = OAUTH_ACCESS_TOKEN_TTL_SECONDS,
): { token: string; expiresIn: number } {
  if (!config.JWT_SECRET) throw new Error('signAccessToken: JWT_SECRET is not configured');
  const token = jwt.sign(
    {
      client_id: snapshot.client_id,
      gid: snapshot.grant_id,
      scope: snapshot.scope,
      policy: snapshot.policy,
      roles: snapshot.roles,
    },
    config.JWT_SECRET,
    {
      algorithm: 'HS256',
      header: { alg: 'HS256', typ: ACCESS_TOKEN_TYPE },
      issuer: target.issuer,
      audience: target.audience,
      subject: snapshot.user_id,
      expiresIn: ttlSeconds,
    },
  );
  return { token, expiresIn: ttlSeconds };
}

/** The claims of a valid access token for `target`; null for anything else. */
export function verifyAccessToken(token: string, target: AccessTokenTarget): LTAccessTokenClaims | null {
  if (!config.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: target.issuer,
      audience: target.audience,
      complete: true,
    });
    if (decoded.header.typ !== ACCESS_TOKEN_TYPE) return null;
    const claims = decoded.payload as LTAccessTokenClaims;
    if (typeof claims.exp !== 'number') return null;
    if (!claims.sub || !claims.gid || !claims.client_id || !Array.isArray(claims.roles)) return null;
    return claims;
  } catch {
    return null;
  }
}

function highestRoleType(roles: LTGrantRole[]): LTRoleType {
  if (roles.some((r) => r.type === 'superadmin')) return 'superadmin';
  if (roles.some((r) => r.type === 'admin')) return 'admin';
  return 'member';
}

/**
 * The request identity for a verified access token and its live grant, in the
 * shape other credentials produce. Roles, policy and scope come from the grant
 * as it stands now, not as the token recorded them.
 */
export function accessTokenPrincipal(claims: LTAccessTokenClaims, live: LTGrantSnapshot): AuthPayload {
  return {
    userId: claims.sub,
    role: highestRoleType(live.roles),
    roles: live.roles.map((r) => ({ role: r.role, type: r.type })),
    scopes: [live.scope],
    principalType: OAUTH_PRINCIPAL_TYPE,
    clientId: live.client_id,
    grantId: live.grant_id,
    policy: live.policy,
    grantRoles: live.roles,
  };
}
