import * as crypto from 'crypto';

import { getPool } from '../../lib/db';
import * as userService from '../../services/user';
import { registerClient, issueAuthorizationCode, pkceChallenge } from '../../services/auth/oauth-server';
import type { LTGrantPolicy } from '../../types';

export const REDIRECT_URI = 'http://127.0.0.1:33418/callback';
export const READ_ONLY: LTGrantPolicy = { preset: 'read_only' };

/** A PKCE verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

/** A member of `role` (read all, write all) and a registered client. */
export async function createGrantFixture(stamp: string, role: string) {
  const user = await userService.createUser({
    external_id: `oauth-fixture-${stamp}`,
    roles: [{ role, type: 'member', read_scope: 'all', write_scope: 'all' } as any],
  });
  const client = await registerClient({ clientName: 'fixture', redirectUris: [REDIRECT_URI] });
  return { userId: user.id, clientId: client.client_id };
}

/** Issue a code for the fixture user and client. */
export async function issueCode(fixture: { userId: string; clientId: string }, options: { ttlSeconds?: number } = {}) {
  const pkce = pkcePair();
  const issued = await issueAuthorizationCode({
    userId: fixture.userId, clientId: fixture.clientId, policy: READ_ONLY, scope: 'mcp:read',
    redirectUri: REDIRECT_URI, codeChallenge: pkce.challenge, resource: 'http://localhost:3000/mcp',
    ttlSeconds: options.ttlSeconds ?? 60,
  });
  return { ...issued, verifier: pkce.verifier };
}

export async function removeGrantFixture(fixture: { userId: string; clientId: string }): Promise<void> {
  await getPool().query('DELETE FROM lt_oauth_clients WHERE client_id = $1', [fixture.clientId]);
  await getPool().query('DELETE FROM lt_users WHERE id = $1', [fixture.userId]);
}
