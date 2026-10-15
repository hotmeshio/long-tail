import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../../lib/db/migrate';
import { getPool } from '../../../../lib/db';
import * as userService from '../../../../services/user';
import {
  REFRESH_REUSE_GRACE_SECONDS, hashSecret, exchangeAuthorizationCode, rotateRefreshToken,
  revokeByRefreshToken, revokeGrant,
} from '../../../../services/auth/oauth-server';
import { REDIRECT_URI, createGrantFixture, issueCode, removeGrantFixture } from '../../../helpers/oauth-server-fixtures';

const STAMP = `${Date.now()}-refresh`;
const ROLE = `oauth-refresh-${STAMP}`;
const OTHER_ROLE = `oauth-refresh-extra-${STAMP}`;
const OTHER_USER = '00000000-0000-4000-8000-00000000abcd';
let fixture: { userId: string; clientId: string };

async function grantWithRefreshToken(): Promise<{ grantId: string; refreshToken: string }> {
  const { code, grantId, verifier } = await issueCode(fixture);
  const exchanged = await exchangeAuthorizationCode({
    code, codeVerifier: verifier, clientId: fixture.clientId, redirectUri: REDIRECT_URI, refreshTtlSeconds: 3600,
  });
  return { grantId, refreshToken: exchanged!.refreshToken };
}

const rotate = (refreshToken: string, clientId = fixture.clientId) => rotateRefreshToken({ refreshToken, clientId, refreshTtlSeconds: 3600 });

beforeAll(async () => {
  await migrate();
  fixture = await createGrantFixture(STAMP, ROLE);
}, 30_000);

afterAll(async () => { await removeGrantFixture(fixture); });

describe('OAuth store: refresh rotation', () => {
  it('rotates to a new token and returns the person\'s current roles', async () => {
    const { grantId, refreshToken } = await grantWithRefreshToken();
    await userService.addUserRole(fixture.userId, OTHER_ROLE, 'member', { read_scope: 'all', write_scope: 'none' });
    const rotated = await rotate(refreshToken);
    expect(rotated.snapshot?.grant_id).toBe(grantId);
    expect(rotated.snapshot?.roles.map((r) => `${r.role}:${r.write_scope}`)).toEqual(
      [`${ROLE}:all`, `${OTHER_ROLE}:none`].sort(),
    );
    expect('refreshToken' in rotated && rotated.refreshToken).not.toBe(refreshToken);
  });

  it('the old token stops working; the new one works', async () => {
    const { refreshToken } = await grantWithRefreshToken();
    const first = await rotate(refreshToken);
    expect((await rotate(refreshToken)).snapshot).toBeNull();
    expect((await rotate((first as { refreshToken: string }).refreshToken)).snapshot).not.toBeNull();
  });

  it('only the client that holds the token can rotate it, and a wrong client does not spend it', async () => {
    const { refreshToken } = await grantWithRefreshToken();
    expect((await rotate(refreshToken, 'ltc_someone-else')).snapshot).toBeNull();
    expect((await rotate(refreshToken)).snapshot).not.toBeNull();
  });

  it('two concurrent refreshes of one token: exactly one succeeds', async () => {
    const { refreshToken } = await grantWithRefreshToken();
    const results = await Promise.all([rotate(refreshToken), rotate(refreshToken)]);
    expect(results.filter((r) => r.snapshot !== null)).toHaveLength(1);
  });

  it('a reused token within the grace window does not revoke the grant', async () => {
    const { grantId, refreshToken } = await grantWithRefreshToken();
    await rotate(refreshToken);
    const reused = await rotate(refreshToken);
    expect(reused).toEqual({ snapshot: null, revoked: null });
    const { rows } = await getPool().query('SELECT revoked_at FROM lt_oauth_grants WHERE id = $1', [grantId]);
    expect(rows[0].revoked_at).toBeNull();
  });

  it('a reused token after the grace window revokes the grant, and its successor stops working', async () => {
    const { grantId, refreshToken } = await grantWithRefreshToken();
    const first = (await rotate(refreshToken)) as { refreshToken: string };
    await getPool().query(
      `UPDATE lt_oauth_refresh_tokens SET used_at = NOW() - make_interval(secs => $2) WHERE token_hash = $1`,
      [hashSecret(refreshToken), REFRESH_REUSE_GRACE_SECONDS + 1],
    );
    expect(await rotate(refreshToken)).toEqual({ snapshot: null, revoked: { grant_id: grantId, user_id: fixture.userId } });
    expect((await rotate(first.refreshToken)).snapshot).toBeNull();
  });

  it('stops refreshing when the owner is no longer active', async () => {
    const { refreshToken } = await grantWithRefreshToken();
    await getPool().query(`UPDATE lt_users SET status = 'inactive' WHERE id = $1`, [fixture.userId]);
    try {
      expect((await rotate(refreshToken)).snapshot).toBeNull();
    } finally {
      await getPool().query(`UPDATE lt_users SET status = 'active' WHERE id = $1`, [fixture.userId]);
    }
  });

  it('refuses an expired token', async () => {
    const { refreshToken } = await grantWithRefreshToken();
    await getPool().query(`UPDATE lt_oauth_refresh_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1`, [hashSecret(refreshToken)]);
    expect((await rotate(refreshToken)).snapshot).toBeNull();
  });
});

describe('OAuth store: revocation', () => {
  it('revokeByRefreshToken revokes only for the client that holds the token', async () => {
    const { grantId, refreshToken } = await grantWithRefreshToken();
    expect(await revokeByRefreshToken(refreshToken, 'ltc_someone-else')).toBeNull();
    expect(await revokeByRefreshToken(refreshToken, fixture.clientId)).toEqual({ grant_id: grantId, user_id: fixture.userId });
    expect((await rotate(refreshToken)).snapshot).toBeNull();
  });

  it('revokeGrant scoped to a user refuses someone else\'s grant', async () => {
    const { grantId } = await grantWithRefreshToken();
    expect(await revokeGrant(grantId, OTHER_USER)).toBeNull();
    expect(await revokeGrant(grantId, fixture.userId)).toEqual({ grant_id: grantId, user_id: fixture.userId });
    expect(await revokeGrant(grantId)).toBeNull();
  });

  it('revokeGrant ignores ids that are not UUIDs without querying', async () => {
    expect(await revokeGrant('not-a-uuid')).toBeNull();
  });
});
