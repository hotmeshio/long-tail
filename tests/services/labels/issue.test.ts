import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { issueLabels, previewLabels, LabelRequestError } from '../../../services/labels';
import { CREDENTIAL_ISSUER_ROLE } from '../../../modules/capabilities';
import { createLabelFixtures, type LabelFixtures } from '../../helpers/label-fixtures';

const { Connection } = Durable;

describe('issuing labels', () => {
  let fx: LabelFixtures;
  let admin: { userId: string; role: string };
  let member: { userId: string };
  let issuer: { userId: string };
  let holder: string;

  const list = { kind: 'list' as const, text: 'target,subtitle\nA-1,Acme North\nA-2,Acme South' };

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    fx = await createLabelFixtures(86, 'issue');
    admin = { userId: await fx.mkUser(), role: 'admin' };
    member = { userId: await fx.mkUser() };
    issuer = { userId: await fx.mkUser({}, [{ role: CREDENTIAL_ISSUER_ROLE, type: 'member' }]) };
    holder = await fx.mkUser({ [fx.badgeKey]: 'ISSUE-TOKEN-SECRET-1' });
  }, 60_000);

  afterAll(async () => fx.cleanup());

  const jobsFor = async (template: string) =>
    (await getPool().query('SELECT * FROM lt_label_jobs WHERE template_name = $1 ORDER BY created_at', [template])).rows;

  it('previews item labels with codes and item text, recording nothing', async () => {
    const preview = await previewLabels({ template: fx.itemTemplate, source: list }, admin);
    expect(preview.labelCount).toBe(2);
    const json = JSON.stringify(preview.sheet);
    expect(json).toContain(`${fx.itemScheme}:0:A-1`);
    expect(json).toContain('Acme South');
    expect(await jobsFor(fx.itemTemplate)).toHaveLength(0);
  });

  it('flags targets that name no row today', async () => {
    const preview = await previewLabels({ template: fx.itemTemplate, source: list }, admin);
    expect(preview.warnings.filter((w) => w.kind === 'unresolved').map((w) => w.index)).toEqual([0, 1]);
  });

  it('refuses a member', async () => {
    await expect(issueLabels({ template: fx.itemTemplate, source: list, output: 'sheet' }, member)).rejects.toMatchObject({ status: 403 });
  });

  it('issues a sheet and records the job with its targets', async () => {
    const result = await issueLabels({ template: fx.itemTemplate, source: list, output: 'sheet' }, admin);
    expect(result.sheet?.pages[0].labels).toHaveLength(2);
    const [row] = await jobsFor(fx.itemTemplate);
    expect(row).toMatchObject({ id: result.job.id, action: 'print', requested_by: admin.userId, targets: ['A-1', 'A-2'], label_count: 2, sensitive: false });
  });

  it('an idempotency key records one job; the replay renders the same labels', async () => {
    const req = { template: fx.itemTemplate, source: list, output: 'sheet' as const, idempotencyKey: `issue-${Date.now()}` };
    const first = await issueLabels(req, admin);
    const second = await issueLabels(req, admin);
    expect(second).toMatchObject({ replay: true, job: { id: first.job.id } });
    expect(second.sheet?.pages[0].labels).toHaveLength(2);
    expect((await jobsFor(fx.itemTemplate)).filter((r) => r.idempotency_key === req.idempotencyKey)).toHaveLength(1);
  });

  it('refuses ZPL on sheet stock before recording', async () => {
    const before = (await jobsFor(fx.itemTemplate)).length;
    await expect(issueLabels({ template: fx.itemTemplate, source: list, output: 'zpl' }, admin)).rejects.toMatchObject({ status: 400 });
    expect(await jobsFor(fx.itemTemplate)).toHaveLength(before);
  });

  it('issues ZPL on thermal media', async () => {
    const result = await issueLabels({ template: fx.itemTemplate, source: list, output: 'zpl', layout: { media: 'thermal-4x2' } }, admin);
    expect(result.zpl?.match(/\^XA/g)).toHaveLength(2);
  });

  it('refuses an unregistered transport loudly', async () => {
    await expect(issueLabels({ template: fx.itemTemplate, source: list, output: 'transport:nowhere' }, admin)).rejects.toThrow(/No label transport/);
  });

  describe('badges', () => {
    const users = () => ({ kind: 'users' as const, userIds: [holder] });

    it('an admin without credential-issuer may not print a badge', async () => {
      await expect(previewLabels({ template: fx.badgeTemplate, source: users() }, admin)).rejects.toMatchObject({ status: 403 });
    });

    it('previews masked: no token anywhere', async () => {
      const preview = await previewLabels({ template: fx.badgeTemplate, source: users() }, issuer);
      expect(JSON.stringify(preview)).not.toContain('ISSUE-TOKEN-SECRET-1');
      expect(preview.sheet.pages[0].labels[0].elements.some((e) => e.kind === 'symbol' && e.masked)).toBe(true);
    });

    it('needs confirmation and records nothing without it', async () => {
      await expect(issueLabels({ template: fx.badgeTemplate, source: users(), output: 'sheet' }, issuer))
        .rejects.toMatchObject({ status: 428 });
      expect(await jobsFor(fx.badgeTemplate)).toHaveLength(0);
    });

    it('a confirmed print records the subject, never the token, then prints the code', async () => {
      const result = await issueLabels({ template: fx.badgeTemplate, source: users(), output: 'sheet', confirm: true }, issuer);
      expect(JSON.stringify(result.sheet)).toContain(`${fx.badgeScheme}:0:ISSUE-TOKEN-SECRET-1`);
      const [row] = await jobsFor(fx.badgeTemplate);
      expect(row).toMatchObject({ requested_by: issuer.userId, subject_user_ids: [holder], targets: null, sensitive: true });
      expect(JSON.stringify(row)).not.toContain('ISSUE-TOKEN-SECRET-1');
    });

    it('refuses pasted badge tokens', async () => {
      await expect(issueLabels({ template: fx.badgeTemplate, source: { kind: 'list', text: 'X' }, output: 'sheet', confirm: true }, issuer))
        .rejects.toBeInstanceOf(LabelRequestError);
    });
  });
});
