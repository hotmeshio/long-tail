import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as userService from '../../../services/user';
import { reissueBadge } from '../../../services/labels';
import { createLabelFixtures, type LabelFixtures } from '../../helpers/label-fixtures';

const { Connection } = Durable;

describe('reissuing a badge', () => {
  let fx: LabelFixtures;
  let superadmin: { userId: string; role: string };
  let holder: string;
  const OLD = 'REISSUE-OLD-TOKEN-1';

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    fx = await createLabelFixtures(84, 'reissue');
    superadmin = { userId: await fx.mkUser(), role: 'superadmin' };
    holder = await fx.mkUser({ [fx.badgeKey]: OLD });
  }, 60_000);

  afterAll(async () => fx.cleanup());

  it('needs confirmation and leaves the badge alone without it', async () => {
    await expect(reissueBadge({ userId: holder, template: fx.badgeTemplate, output: 'sheet' }, superadmin)).rejects.toMatchObject({ status: 428 });
    expect((await userService.getUser(holder))?.metadata?.[fx.badgeKey]).toBe(OLD);
  });

  it('refuses an admin without credential-issuer', async () => {
    const admin = { userId: await fx.mkUser(), role: 'admin' };
    await expect(reissueBadge({ userId: holder, template: fx.badgeTemplate, output: 'sheet', confirm: true }, admin)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an inactive user in the rotation statement, leaving no ledger row', async () => {
    const inactive = await fx.mkUser({ [fx.badgeKey]: 'REISSUE-INACTIVE-1' });
    await userService.updateUser(inactive, { status: 'inactive' });
    await expect(reissueBadge({ userId: inactive, template: fx.badgeTemplate, output: 'sheet', confirm: true }, superadmin))
      .rejects.toMatchObject({ status: 400 });
    expect((await userService.getUser(inactive))?.metadata?.[fx.badgeKey]).toBe('REISSUE-INACTIVE-1');
    const { rows } = await getPool().query('SELECT 1 FROM lt_label_jobs WHERE $1 = ANY(subject_user_ids)', [inactive]);
    expect(rows).toHaveLength(0);
  });

  it('refuses an item template', async () => {
    await expect(reissueBadge({ userId: holder, template: fx.itemTemplate, output: 'sheet', confirm: true }, superadmin)).rejects.toMatchObject({ status: 400 });
  });

  it('rotates the credential, records reissue and print, and prints the new code', async () => {
    const result = await reissueBadge({ userId: holder, template: fx.badgeTemplate, output: 'sheet', confirm: true }, superadmin);
    const fresh = (await userService.getUser(holder))?.metadata?.[fx.badgeKey];
    expect(fresh).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(fresh).not.toBe(OLD);
    expect(await userService.getUserByMetadataValue(fx.badgeKey, OLD)).toBeNull();
    expect(JSON.stringify(result.sheet)).toContain(`${fx.badgeScheme}:0:${fresh}`);

    const { rows } = await getPool().query(
      'SELECT id, action, requested_by FROM lt_label_jobs WHERE $1 = ANY(subject_user_ids) ORDER BY created_at', [holder],
    );
    expect(rows.map((r) => r.action)).toEqual(['reissue', 'print']);
    expect(rows[0].id).toBe(result.reissueJobId);
    expect(JSON.stringify(rows)).not.toContain(String(fresh));
  });
});
