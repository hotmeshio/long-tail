import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../setup';
import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import * as api from '../../api/users';
import * as userService from '../../services/user';
import { deleteScanScheme, upsertScanScheme } from '../../services/scan-code';
import { SCAN_ENCODINGS, SCAN_SCHEME_KINDS } from '../../types/scan-code';

const { Connection } = Durable;

// protectIdentityKeys: false keeps the earlier users API behavior.

const SCHEME = 79;
const KEY = 'test_optout_badge';

describe('users API with identity key protection off', () => {
  const created: string[] = [];
  let holderId: string;
  let builderId: string;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await upsertScanScheme({
      version: SCHEME, name: 'Opt-out badge', target_facet: KEY, encoding: SCAN_ENCODINGS.DELIMITED, delimiter: ':',
      kind: SCAN_SCHEME_KINDS.IDENTITY, grant_ttl_seconds: 300, grant_max_uses: 1,
    } as any);
    holderId = (await userService.createUser({ external_id: `optout-${Date.now()}-h`, metadata: { [KEY]: 'OPTOUT-1' } })).id;
    builderId = (await userService.createUser({ external_id: `optout-${Date.now()}-b` })).id;
    created.push(holderId, builderId);
    userService.setIdentityKeyProtection(false);
  }, 60_000);

  afterAll(async () => {
    userService.setIdentityKeyProtection(true);
    await getPool().query('DELETE FROM lt_label_jobs WHERE subject_user_ids && $1::uuid[]', [created]);
    for (const id of created) await userService.deleteUser(id);
    await deleteScanScheme(SCHEME);
  });

  it('reads carry the identity key', async () => {
    expect((await api.getUser({ id: holderId })).data.metadata[KEY]).toBe('OPTOUT-1');
  });

  it('a wholesale write may set the identity key', async () => {
    const result = await api.createUser({ external_id: `optout-${Date.now()}-c`, metadata: { [KEY]: 'OPTOUT-2' } });
    expect(result.status).toBe(201);
    created.push(result.data.id);
  });

  it('a caller without credential-issuer may patch it; the bind is still recorded', async () => {
    const result = await api.patchUserProperties({ id: holderId, set: { [KEY]: 'OPTOUT-3' } }, { userId: builderId });
    expect(result.status).toBe(200);
    expect(result.data.metadata[KEY]).toBe('OPTOUT-3');
    const { rows } = await getPool().query('SELECT action FROM lt_label_jobs WHERE $1 = ANY(subject_user_ids)', [holderId]);
    expect(rows).toEqual([{ action: 'bind' }]);
  });
});
