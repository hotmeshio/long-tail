import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../../lib/db/migrate';
import { getPool } from '../../../../lib/db';
import {
  exchangeAuthorizationCode, rotateRefreshToken, revokeGrant, pruneOAuthServer,
} from '../../../../services/auth/oauth-server';
import { REDIRECT_URI, createGrantFixture, issueCode, removeGrantFixture } from '../../../helpers/oauth-server-fixtures';

// Maintenance removes what the authorization server can no longer use, and
// nothing a client still holds.
const STAMP = `${Date.now()}-prune`;
const fixtures: Array<{ userId: string; clientId: string }> = [];
const WINDOW = '7 days';
const LONG_AGO = "NOW() - INTERVAL '30 days'";

const fixture = async (name: string) => {
  const f = await createGrantFixture(`${STAMP}-${name}`, `oauth-prune-${STAMP}-${name}`);
  fixtures.push(f);
  return f;
};

/** A code exchanged for a grant and its first refresh token. */
const exchanged = async (f: { userId: string; clientId: string }) => {
  const { code, grantId, verifier } = await issueCode(f);
  const result = await exchangeAuthorizationCode({
    code, codeVerifier: verifier, clientId: f.clientId, redirectUri: REDIRECT_URI, refreshTtlSeconds: 3600,
  });
  return { grantId, refreshToken: result!.refreshToken };
};

const age = (sql: string, id: string) => getPool().query(sql.replaceAll('$AGO', LONG_AGO), [id]);
const exists = async (table: string, column: string, id: string) =>
  (await getPool().query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [id])).rowCount === 1;

beforeAll(async () => { await migrate(); }, 30_000);
afterAll(async () => { for (const f of fixtures) await removeGrantFixture(f); });

describe('pruneOAuthServer', () => {
  it('drops a grant whose code was never exchanged, once the code is long expired', async () => {
    const f = await fixture('unexchanged');
    const { grantId } = await issueCode(f);
    await age('UPDATE lt_oauth_codes SET expires_at = $AGO WHERE grant_id = $1', grantId);
    await age('UPDATE lt_oauth_grants SET created_at = $AGO WHERE id = $1', grantId);
    await pruneOAuthServer(WINDOW);
    expect(await exists('lt_oauth_grants', 'id', grantId)).toBe(false);
  });

  it('keeps a grant in use, dropping only its spent code and rotated-out refresh token', async () => {
    const f = await fixture('in-use');
    const { grantId, refreshToken } = await exchanged(f);
    await rotateRefreshToken({ refreshToken, clientId: f.clientId, refreshTtlSeconds: 3600 });
    await age('UPDATE lt_oauth_codes SET expires_at = $AGO WHERE grant_id = $1', grantId);
    await age('UPDATE lt_oauth_refresh_tokens SET used_at = $AGO WHERE grant_id = $1 AND used_at IS NOT NULL', grantId);
    await age('UPDATE lt_oauth_grants SET created_at = $AGO WHERE id = $1', grantId);
    await age('UPDATE lt_oauth_clients SET created_at = $AGO WHERE client_id = $1', f.clientId);

    await pruneOAuthServer(WINDOW);

    expect(await exists('lt_oauth_grants', 'id', grantId)).toBe(true);
    expect(await exists('lt_oauth_clients', 'client_id', f.clientId)).toBe(true);
    expect(await exists('lt_oauth_codes', 'grant_id', grantId)).toBe(false);
    const tokens = await getPool().query('SELECT used_at FROM lt_oauth_refresh_tokens WHERE grant_id = $1', [grantId]);
    expect(tokens.rows).toEqual([{ used_at: null }]);
  });

  it('drops a grant revoked long ago, and then its client, which has no live grant', async () => {
    const f = await fixture('revoked');
    const { grantId } = await exchanged(f);
    await revokeGrant(grantId);
    await age('UPDATE lt_oauth_grants SET revoked_at = $AGO WHERE id = $1', grantId);
    await age('UPDATE lt_oauth_clients SET created_at = $AGO WHERE client_id = $1', f.clientId);
    await pruneOAuthServer(WINDOW);
    expect(await exists('lt_oauth_grants', 'id', grantId)).toBe(false);
    expect(await exists('lt_oauth_clients', 'client_id', f.clientId)).toBe(false);
  });

  it('keeps a recently registered client that has no grant yet', async () => {
    const f = await fixture('fresh-client');
    await pruneOAuthServer(WINDOW);
    expect(await exists('lt_oauth_clients', 'client_id', f.clientId)).toBe(true);
  });
});
