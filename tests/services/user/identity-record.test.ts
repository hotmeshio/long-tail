import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as userService from '../../../services/user';
import { deleteScanScheme, upsertScanScheme } from '../../../services/scan-code';
import { SCAN_ENCODINGS, SCAN_SCHEME_KINDS } from '../../../types/scan-code';

const { Connection } = Durable;

// Identity bindings recorded in lt_label_jobs by the same statement as the patch.

const SCHEME = 96;
const KEY = 'test_record_badge';

describe('recorded identity patches', () => {
  const created: string[] = [];
  let userId: string;
  let otherId: string;
  let requesterId: string;

  async function mkUser(metadata: Record<string, any> = {}) {
    const user = await userService.createUser({
      external_id: `ident-rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      metadata,
    });
    created.push(user.id);
    return user;
  }

  async function ledgerFor(subject: string) {
    const { rows } = await getPool().query(
      'SELECT * FROM lt_label_jobs WHERE $1 = ANY(subject_user_ids) ORDER BY created_at',
      [subject],
    );
    return rows;
  }

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await upsertScanScheme({
      version: SCHEME,
      name: 'Record test badge',
      target_facet: KEY,
      encoding: SCAN_ENCODINGS.DELIMITED,
      delimiter: ':',
      kind: SCAN_SCHEME_KINDS.IDENTITY,
      grant_ttl_seconds: 300,
      grant_max_uses: 1,
    } as any);
    userId = (await mkUser({ [KEY]: 'REC-1', shift: 'day' })).id;
    otherId = (await mkUser({ [KEY]: 'REC-2' })).id;
    requesterId = (await mkUser()).id;
  }, 60_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_label_jobs WHERE subject_user_ids && $1::uuid[]', [created]);
    for (const id of created) await userService.deleteUser(id);
    await deleteScanScheme(SCHEME);
  });

  it('names the identity keys a patch touches', async () => {
    expect(await userService.identityKeysTouched({ set: { shift: 'x' } })).toEqual([]);
    expect(await userService.identityKeysTouched({ remove: [KEY] })).toEqual([KEY]);
    expect(await userService.identityKeysTouched({ rename: { old: KEY } })).toEqual([KEY]);
  });

  it('writes the patch and one ledger row together, never the value', async () => {
    const result = await userService.patchUserPropertiesRecorded(userId, { set: { [KEY]: 'REC-3' } }, {
      action: 'bind',
      requested_by: requesterId,
      source: { keys: [KEY] },
    });
    expect(result?.user.metadata?.[KEY]).toBe('REC-3');
    expect((result?.user as any).ledger_id).toBeUndefined();
    const rows = await ledgerFor(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: result!.jobId, action: 'bind', requested_by: requesterId, sensitive: true });
    expect(JSON.stringify(rows[0])).not.toContain('REC-3');
  });

  it('writes no ledger row when the uniqueness guard refuses the patch', async () => {
    await expect(userService.patchUserPropertiesRecorded(otherId, { set: { [KEY]: 'REC-3' } }, {
      action: 'bind',
      requested_by: requesterId,
      source: { keys: [KEY] },
    })).rejects.toThrow(/already bound/);
    expect(await ledgerFor(otherId)).toHaveLength(0);
  });

  it('a wholesale metadata replace keeps identity bindings it leaves out', async () => {
    const user = await userService.updateUser(userId, { metadata: { shift: 'night' } });
    expect(user?.metadata).toEqual({ [KEY]: 'REC-3', shift: 'night' });
  });

  it('a wholesale replace that names the identity key sets it', async () => {
    const user = await userService.updateUser(otherId, { metadata: { [KEY]: 'REC-4' } });
    expect(user?.metadata?.[KEY]).toBe('REC-4');
  });
});
