import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { signToken } from '../../modules/auth';
import { createLabelFixtures, type LabelFixtures } from '../helpers/label-fixtures';

describe('label routes', () => {
  const ctx = setupRouteTest(4657);
  let fx: LabelFixtures;
  let adminToken: string;
  let holder: string;

  beforeAll(async () => {
    fx = await createLabelFixtures(82, 'routelbl');
    adminToken = signToken({ userId: await fx.mkUser(), role: 'admin' });
    holder = await fx.mkUser({ [fx.badgeKey]: 'ROUTE-TOKEN-SECRET' });
  }, 60_000);

  afterAll(async () => fx.cleanup());

  const post = (path: string, token: string, body: unknown) =>
    fetch(`${ctx.BASE}/labels${path}`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) });

  it('requires authentication', async () => {
    expect((await fetch(`${ctx.BASE}/labels/templates`)).status).toBe(401);
  });

  it('lists media with the default', async () => {
    const res = await fetch(`${ctx.BASE}/labels/media`, { headers: authHeaders(ctx.memberToken) });
    const body = await res.json();
    expect(body.defaultMedia).toBe('a4-l7160');
    expect(body.media.some((m: { id: string }) => m.id === 'thermal-4x6')).toBe(true);
  });

  it('a member may read templates but not issue', async () => {
    expect((await fetch(`${ctx.BASE}/labels/templates?scheme=${fx.itemScheme}`, { headers: authHeaders(ctx.memberToken) })).status).toBe(200);
    const res = await post('/issue', ctx.memberToken, { template: fx.itemTemplate, source: { kind: 'list', text: 'A' }, output: 'sheet' });
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('an admin downloads a PDF with the job id header', async () => {
    const res = await post('/issue', adminToken, { template: fx.itemTemplate, source: { kind: 'range', prefix: 'A-', from: 1, to: 3 }, output: 'pdf' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-lt-label-job')).toMatch(/^[0-9a-f-]{36}$/);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('an admin cannot print a badge; a superadmin must confirm', async () => {
    const body = { template: fx.badgeTemplate, source: { kind: 'users', userIds: [holder] }, output: 'sheet' };
    expect((await post('/issue', adminToken, { ...body, confirm: true })).status).toBe(403);
    expect((await post('/issue', ctx.builderToken, body)).status).toBe(428);
    const ok = await post('/issue', ctx.builderToken, { ...body, confirm: true });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toContain('ROUTE-TOKEN-SECRET');
  });

  it('a masked badge preview carries no token', async () => {
    const res = await post('/preview', ctx.builderToken, { template: fx.badgeTemplate, source: { kind: 'users', userIds: [holder] } });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('ROUTE-TOKEN-SECRET');
  });

  it('job history hides badge jobs from a reader without credential access', async () => {
    const asAdmin = await (await fetch(`${ctx.BASE}/labels/jobs?template=${fx.badgeTemplate}`, { headers: authHeaders(adminToken) })).json();
    expect(asAdmin.jobs).toEqual([]);
    const asSuper = await (await fetch(`${ctx.BASE}/labels/jobs?template=${fx.badgeTemplate}`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(asSuper.jobs.length).toBeGreaterThan(0);
  });

  it('reprints one label of a recorded job as a new job', async () => {
    const first = await post('/issue', adminToken, { template: fx.itemTemplate, source: { kind: 'list', text: 'A-1\nA-2' }, output: 'sheet' });
    const jobId = first.headers.get('x-lt-label-job');
    const again = await post(`/jobs/${jobId}/reprint`, adminToken, { indices: [1], output: 'sheet' });
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body.job.id).not.toBe(jobId);
    expect(body.job.targets).toEqual(['A-2']);
  });
});
