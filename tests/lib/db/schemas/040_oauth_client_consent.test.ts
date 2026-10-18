import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../../lib/db/migrate';
import { getPool } from '../../../../lib/db';
import { createGrantFixture, issueCode, removeGrantFixture } from '../../../helpers/oauth-server-fixtures';

// Clients consented to before the migration take their newest grant's time,
// so the sweep keeps them; a client never consented to stays unstamped.
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../../../../lib/db/schemas/040_oauth_client_consent.sql'), 'utf8',
);
const STAMP = `${Date.now()}-m040`;
const ROLE = `oauth-m040-${STAMP}`;
const fixtures: Array<{ userId: string; clientId: string }> = [];

const consentOf = async (clientId: string) =>
  (await getPool().query('SELECT last_consent_at FROM lt_oauth_clients WHERE client_id = $1', [clientId])).rows[0].last_consent_at;

beforeAll(async () => { await migrate(); }, 30_000);
afterAll(async () => { for (const f of fixtures) await removeGrantFixture(f); });

describe('migration 040: client consent', () => {
  it('backfills a consented client from its newest grant, and leaves an unconsented one null', async () => {
    const consented = await createGrantFixture(`${STAMP}-a`, ROLE);
    const unconsented = await createGrantFixture(`${STAMP}-b`, ROLE);
    fixtures.push(consented, unconsented);
    await issueCode(consented);
    const { grantId } = await issueCode(consented);
    await getPool().query(
      "UPDATE lt_oauth_grants SET created_at = NOW() + INTERVAL '1 minute' WHERE id = $1", [grantId],
    );
    await getPool().query(
      'UPDATE lt_oauth_clients SET last_consent_at = NULL WHERE client_id = ANY($1)',
      [[consented.clientId, unconsented.clientId]],
    );

    await getPool().query(MIGRATION);

    const newest = (await getPool().query('SELECT created_at FROM lt_oauth_grants WHERE id = $1', [grantId])).rows[0].created_at;
    expect(await consentOf(consented.clientId)).toEqual(newest);
    expect(await consentOf(unconsented.clientId)).toBeNull();
  });

  it('runs again without change', async () => {
    const f = await createGrantFixture(`${STAMP}-c`, ROLE);
    fixtures.push(f);
    await issueCode(f);
    const before = await consentOf(f.clientId);
    await getPool().query(MIGRATION);
    expect(await consentOf(f.clientId)).toEqual(before);
  });
});
