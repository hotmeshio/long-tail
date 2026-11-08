import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../setup';
import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import * as api from '../../api/users';
import * as userService from '../../services/user';
import { deleteScanScheme, upsertScanScheme } from '../../services/scan-code';
import { CREDENTIAL_ISSUER_ROLE } from '../../modules/capabilities';
import { SCAN_ENCODINGS, SCAN_SCHEME_KINDS } from '../../types/scan-code';

const { Connection } = Durable;

// Identity keys are credentials: user reads never carry them, and binding one
// needs the credentialIssuer capability and leaves a ledger row.

const SCHEME = 95;
const KEY = 'test_api_badge';

describe('users API identity keys', () => {
  const created: string[] = [];
  let holderId: string;
  let memberId: string;
  let issuerId: string;

  async function mkUser(metadata: Record<string, any> = {}, role?: string) {
    const user = await userService.createUser({
      external_id: `ident-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      metadata,
      roles: role ? [{ role, type: 'member' }] : undefined,
    });
    created.push(user.id);
    return user;
  }

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await upsertScanScheme({
      version: SCHEME,
      name: 'API test badge',
      target_facet: KEY,
      encoding: SCAN_ENCODINGS.DELIMITED,
      delimiter: ':',
      kind: SCAN_SCHEME_KINDS.IDENTITY,
      grant_ttl_seconds: 300,
      grant_max_uses: 1,
    } as any);
    holderId = (await mkUser({ [KEY]: 'API-SECRET-1', shift: 'day' })).id;
    memberId = (await mkUser()).id;
    issuerId = (await mkUser({}, CREDENTIAL_ISSUER_ROLE)).id;
  }, 60_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_label_jobs WHERE subject_user_ids && $1::uuid[]', [created]);
    for (const id of created) await userService.deleteUser(id);
    await deleteScanScheme(SCHEME);
  });

  it('getUser redacts the identity key and names it bound', async () => {
    const result = await api.getUser({ id: holderId });
    expect(result.data.metadata).toEqual({ shift: 'day' });
    expect(result.data.identity_bound).toEqual([KEY]);
  });

  it('listUsers redacts every user', async () => {
    const result = await api.listUsers({ search: 'ident-api-', limit: 100 });
    expect(JSON.stringify(result.data)).not.toContain('API-SECRET-1');
  });

  it('refuses an identity key in a wholesale create or update', async () => {
    expect((await api.createUser({ external_id: `x-${Date.now()}`, metadata: { [KEY]: 'NEW' } })).status).toBe(400);
    expect((await api.updateUser({ id: holderId, metadata: { [KEY]: 'NEW' } })).status).toBe(400);
  });

  it('an update without the identity key keeps the binding', async () => {
    const result = await api.updateUser({ id: holderId, metadata: { shift: 'night' } });
    expect(result.status).toBe(200);
    expect((await userService.getUser(holderId))?.metadata?.[KEY]).toBe('API-SECRET-1');
  });

  it('refuses an identity patch without auth or from a member', async () => {
    expect((await api.patchUserProperties({ id: holderId, set: { [KEY]: 'API-2' } })).status).toBe(403);
    expect((await api.patchUserProperties({ id: holderId, remove: [KEY] }, { userId: memberId })).status).toBe(403);
    expect((await api.patchUserProperties({ id: holderId, set: { [KEY]: 'API-2' } }, { userId: memberId, role: 'admin' })).status).toBe(403);
    expect((await userService.getUser(holderId))?.metadata?.[KEY]).toBe('API-SECRET-1');
  });

  it('a credential issuer binds the key, recorded, and reads it back redacted', async () => {
    const result = await api.patchUserProperties({ id: holderId, set: { [KEY]: 'API-SECRET-2' } }, { userId: issuerId });
    expect(result.status).toBe(200);
    expect(result.data.metadata[KEY]).toBeUndefined();
    const { rows } = await getPool().query(
      'SELECT action, requested_by FROM lt_label_jobs WHERE $1 = ANY(subject_user_ids)',
      [holderId],
    );
    expect(rows).toEqual([{ action: 'bind', requested_by: issuerId }]);
  });

  it('a patch of other keys needs no issuer and writes no ledger row', async () => {
    const result = await api.patchUserProperties({ id: memberId, set: { shift: 'day' } }, { userId: memberId });
    expect(result.status).toBe(200);
    const { rows } = await getPool().query('SELECT 1 FROM lt_label_jobs WHERE $1 = ANY(subject_user_ids)', [memberId]);
    expect(rows).toHaveLength(0);
  });
});
