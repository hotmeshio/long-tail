import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../../lib/db/migrate';
import { getPool } from '../../../../lib/db';
import * as userService from '../../../../services/user';
import { exchangeAuthorizationCode, getLiveGrant, revokeGrant } from '../../../../services/auth/oauth-server';
import { REDIRECT_URI, createGrantFixture, issueCode, removeGrantFixture } from '../../../helpers/oauth-server-fixtures';

// /mcp honors an access token only while its grant is live, so a revocation,
// a deactivation or a role change takes effect on the next request everywhere.
const STAMP = `${Date.now()}-live`;
const ROLE = `oauth-live-${STAMP}`;
const EXTRA_ROLE = `oauth-live-extra-${STAMP}`;
let fixture: { userId: string; clientId: string };

async function exchangedGrant(): Promise<string> {
  const { code, grantId, verifier } = await issueCode(fixture);
  await exchangeAuthorizationCode({ code, codeVerifier: verifier, clientId: fixture.clientId, redirectUri: REDIRECT_URI, refreshTtlSeconds: 3600 });
  return grantId;
}

beforeAll(async () => {
  await migrate();
  fixture = await createGrantFixture(STAMP, ROLE);
}, 30_000);

afterAll(async () => { await removeGrantFixture(fixture); });

describe('OAuth store: live grant', () => {
  it('a live grant answers with the owner\'s current roles', async () => {
    const grantId = await exchangedGrant();
    const live = await getLiveGrant(grantId, fixture.userId);
    expect(live?.grant_id).toBe(grantId);
    expect(live?.client_id).toBe(fixture.clientId);
    await userService.addUserRole(fixture.userId, EXTRA_ROLE, 'member', { read_scope: 'all', write_scope: 'none' });
    expect((await getLiveGrant(grantId, fixture.userId))?.roles.map((r) => r.role)).toContain(EXTRA_ROLE);
    await userService.removeUserRole(fixture.userId, EXTRA_ROLE);
    expect((await getLiveGrant(grantId, fixture.userId))?.roles.map((r) => r.role)).not.toContain(EXTRA_ROLE);
  });

  it('a revoked grant is not live', async () => {
    const grantId = await exchangedGrant();
    await revokeGrant(grantId);
    expect(await getLiveGrant(grantId, fixture.userId)).toBeNull();
  });

  it('an inactive owner\'s grant is not live, and is again on reactivation', async () => {
    const grantId = await exchangedGrant();
    await getPool().query(`UPDATE lt_users SET status = 'inactive' WHERE id = $1`, [fixture.userId]);
    expect(await getLiveGrant(grantId, fixture.userId)).toBeNull();
    await getPool().query(`UPDATE lt_users SET status = 'active' WHERE id = $1`, [fixture.userId]);
    expect(await getLiveGrant(grantId, fixture.userId)).not.toBeNull();
  });

  it('a grant named for another user, or a malformed id, is not live', async () => {
    const grantId = await exchangedGrant();
    expect(await getLiveGrant(grantId, '00000000-0000-4000-8000-00000000abcd')).toBeNull();
    expect(await getLiveGrant('not-a-uuid', fixture.userId)).toBeNull();
  });
});
