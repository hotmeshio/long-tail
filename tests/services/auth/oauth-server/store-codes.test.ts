import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../../lib/db/migrate';
import { getPool } from '../../../../lib/db';
import { getClient, exchangeAuthorizationCode } from '../../../../services/auth/oauth-server';
import {
  REDIRECT_URI, READ_ONLY, createGrantFixture, issueCode, removeGrantFixture,
} from '../../../helpers/oauth-server-fixtures';

const STAMP = `${Date.now()}-codes`;
const ROLE = `oauth-codes-${STAMP}`;
let fixture: { userId: string; clientId: string };

const exchange = (code: string, verifier: string, overrides: Partial<{ clientId: string; redirectUri: string }> = {}) =>
  exchangeAuthorizationCode({
    code, codeVerifier: verifier, clientId: overrides.clientId ?? fixture.clientId,
    redirectUri: overrides.redirectUri ?? REDIRECT_URI, refreshTtlSeconds: 3600,
  });

beforeAll(async () => {
  await migrate();
  fixture = await createGrantFixture(STAMP, ROLE);
}, 30_000);

afterAll(async () => { await removeGrantFixture(fixture); });

describe('OAuth store: clients and authorization codes', () => {
  it('registers a client with an opaque id and reads it back', async () => {
    const client = await getClient(fixture.clientId);
    expect(client).toMatchObject({ client_id: fixture.clientId, client_name: 'fixture', redirect_uris: [REDIRECT_URI] });
    expect(fixture.clientId).toMatch(/^ltc_[A-Za-z0-9_-]{43}$/);
  });

  it('exchanges a code for the grant, the person\'s live roles and a refresh token', async () => {
    const { code, grantId, verifier } = await issueCode(fixture);
    const result = await exchange(code, verifier);
    expect(result).not.toBeNull();
    expect(result!.snapshot).toEqual({
      grant_id: grantId, user_id: fixture.userId, client_id: fixture.clientId, policy: READ_ONLY, scope: 'mcp:read',
      roles: [{ role: ROLE, type: 'member', read_scope: 'all', write_scope: 'all' }],
    });
    expect(result!.resource).toBe('http://localhost:3000/mcp');
    expect(result!.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores only hashes of codes and refresh tokens', async () => {
    const { code, grantId, verifier } = await issueCode(fixture);
    const { refreshToken } = (await exchange(code, verifier))!;
    const codes = await getPool().query('SELECT code_hash FROM lt_oauth_codes WHERE grant_id = $1', [grantId]);
    const tokens = await getPool().query('SELECT token_hash FROM lt_oauth_refresh_tokens WHERE grant_id = $1', [grantId]);
    expect(codes.rows.map((r) => r.code_hash)).not.toContain(code);
    expect(tokens.rows.map((r) => r.token_hash)).not.toContain(refreshToken);
  });

  it('a code works once', async () => {
    const { code, verifier } = await issueCode(fixture);
    expect(await exchange(code, verifier)).not.toBeNull();
    expect(await exchange(code, verifier)).toBeNull();
  });

  it('a wrong verifier fails without spending the code', async () => {
    const { code, verifier } = await issueCode(fixture);
    expect(await exchange(code, 'not-the-verifier-not-the-verifier-not-the-v')).toBeNull();
    expect(await exchange(code, verifier)).not.toBeNull();
  });

  it('refuses another client or another redirect URI', async () => {
    const { code, verifier } = await issueCode(fixture);
    expect(await exchange(code, verifier, { clientId: 'ltc_someone-else' })).toBeNull();
    expect(await exchange(code, verifier, { redirectUri: 'http://127.0.0.1:1/other' })).toBeNull();
    expect(await exchange(code, verifier)).not.toBeNull();
  });

  it('refuses an expired code', async () => {
    const { code, verifier } = await issueCode(fixture, { ttlSeconds: -1 });
    expect(await exchange(code, verifier)).toBeNull();
  });

  it('refuses a code whose owner is no longer active', async () => {
    const { code, verifier } = await issueCode(fixture);
    await getPool().query(`UPDATE lt_users SET status = 'suspended' WHERE id = $1`, [fixture.userId]);
    try {
      expect(await exchange(code, verifier)).toBeNull();
    } finally {
      await getPool().query(`UPDATE lt_users SET status = 'active' WHERE id = $1`, [fixture.userId]);
    }
  });

  it('refuses a code whose grant was revoked', async () => {
    const { code, grantId, verifier } = await issueCode(fixture);
    await getPool().query('UPDATE lt_oauth_grants SET revoked_at = NOW() WHERE id = $1', [grantId]);
    expect(await exchange(code, verifier)).toBeNull();
  });
});
