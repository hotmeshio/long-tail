import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { labelTransportRegistry } from '../../../lib/labels/transports';
import { issueLabels } from '../../../services/labels';
import { createLabelFixtures, type LabelFixtures } from '../../helpers/label-fixtures';

const { Connection } = Durable;

// An idempotency key makes a print safe to retry: a transport job is sent
// once under a delivery lease, re-sent after a crash, never sent twice at once.

describe('label delivery and replay', () => {
  let fx: LabelFixtures;
  let admin: { userId: string; role: string };
  const send = vi.fn(async () => ({ accepted: true }));
  const source = { kind: 'list' as const, text: 'A-1\nA-2' };
  const request = (key: string) => ({
    template: fx.itemTemplate, source, output: 'transport:test-drop' as const,
    layout: { media: 'thermal-4x2' }, idempotencyKey: key, destination: 'line-2',
  });
  const job = async (key: string) =>
    (await getPool().query('SELECT * FROM lt_label_jobs WHERE idempotency_key = $1', [key])).rows[0];

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    fx = await createLabelFixtures(80, 'delivery');
    admin = { userId: await fx.mkUser(), role: 'admin' };
    labelTransportRegistry.register('test-drop', { formats: ['zpl'], send });
  }, 60_000);

  afterAll(async () => {
    labelTransportRegistry.clear();
    await fx.cleanup();
  });

  beforeEach(() => send.mockReset().mockResolvedValue({ accepted: true }));

  it('sends once, passes the destination through, and stamps delivery', async () => {
    const key = `d-${Date.now()}-1`;
    const result = await issueLabels(request(key), admin);
    expect(result.delivered).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ format: 'zpl', destination: 'line-2', labelCount: 2 });
    expect((await job(key)).delivered_at).not.toBeNull();
  });

  it('a retry after delivery sends nothing', async () => {
    const key = `d-${Date.now()}-2`;
    await issueLabels(request(key), admin);
    const again = await issueLabels(request(key), admin);
    expect(again).toMatchObject({ replay: true, delivered: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it('concurrent retries of one key send once', async () => {
    const key = `d-${Date.now()}-3`;
    send.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 50)); return { accepted: true }; });
    const results = await Promise.all([issueLabels(request(key), admin), issueLabels(request(key), admin), issueLabels(request(key), admin)]);
    expect(send).toHaveBeenCalledOnce();
    expect(results.filter((r) => r.delivered === true)).toHaveLength(1);
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
  });

  it('a send that failed is re-sent by the retry', async () => {
    const key = `d-${Date.now()}-4`;
    send.mockRejectedValueOnce(new Error('printer offline'));
    await expect(issueLabels(request(key), admin)).rejects.toMatchObject({ status: 502 });
    expect((await job(key)).delivered_at).toBeNull();
    const retry = await issueLabels(request(key), admin);
    expect(retry).toMatchObject({ replay: true, delivered: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a lapsed lease from a crashed sender is re-sent; a live one is not', async () => {
    const key = `d-${Date.now()}-5`;
    send.mockRejectedValueOnce(new Error('crash'));
    await expect(issueLabels(request(key), admin)).rejects.toMatchObject({ status: 502 });
    await getPool().query('UPDATE lt_label_jobs SET delivery_claimed_at = NOW() WHERE idempotency_key = $1', [key]);
    expect((await issueLabels(request(key), admin)).delivered).toBe(false);
    await getPool().query("UPDATE lt_label_jobs SET delivery_claimed_at = NOW() - interval '1 hour' WHERE idempotency_key = $1", [key]);
    expect((await issueLabels(request(key), admin)).delivered).toBe(true);
  });

  it('refuses a key reused for a different request', async () => {
    const key = `d-${Date.now()}-6`;
    await issueLabels(request(key), admin);
    await expect(issueLabels({ ...request(key), output: 'zpl' }, admin)).rejects.toMatchObject({ status: 409 });
  });

  it('a pull output replay renders the recorded labels again', async () => {
    const key = `d-${Date.now()}-7`;
    const req = { template: fx.itemTemplate, source, output: 'sheet' as const, idempotencyKey: key };
    const first = await issueLabels(req, admin);
    const again = await issueLabels({ ...req, source: { kind: 'list', text: 'A-1\nA-2\nA-3' } }, admin);
    expect(again.replay).toBe(true);
    expect(again.sheet?.pages.flatMap((p) => p.labels)).toHaveLength(first.sheet!.pages.flatMap((p) => p.labels).length);
  });
});
