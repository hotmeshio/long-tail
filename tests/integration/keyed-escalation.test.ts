/**
 * Keyed escalations: a standalone row created with a signal_key exists once
 * per key, however many callers race to create it.
 *
 * Requires: docker compose up -d --build (app + Postgres)
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { ApiClient, log, pgQuery } from './helpers';

const PASSWORD = 'l0ngt@1l';
const ROLE = 'reviewer';
const RACERS = 8;

let api: ApiClient;
const run = Date.now().toString(36);

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', PASSWORD);
});

function createKeyed(signal_key: string, role = ROLE) {
  return api.post('/api/escalations', { type: 'keyed-test', role, description: 'keyed row', signal_key });
}

async function rowsHolding(signalKey: string): Promise<any[]> {
  return pgQuery('SELECT id, status FROM public.lt_escalations WHERE signal_key = $1', [signalKey]);
}

describe('keyed escalation create', () => {
  it('concurrent creates on one key make one row: one 201, the rest 200 with its id', async () => {
    const key = `keyed-test:race:${run}`;
    const results = await Promise.all(Array.from({ length: RACERS }, () => createKeyed(key)));

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(RACERS - 1);
    const ids = new Set(results.map((r) => r.data.id));
    expect(ids.size).toBe(1);

    const rows = await rowsHolding(key);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe([...ids][0]);
    log('race', `${RACERS} creates, one row ${rows[0].id}`);
  });

  it('a repeat after the row ended returns the ended row and creates nothing', async () => {
    const key = `keyed-test:ended:${run}`;
    const first = await createKeyed(key);
    await api.post(`/api/escalations/${first.data.id}/resolve`, { resolverPayload: { done: true } });

    const again = await createKeyed(key);
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ id: first.data.id, status: 'resolved' });
    expect(await rowsHolding(key)).toHaveLength(1);
  });

  it('a key held by a row on another role answers 409', async () => {
    const key = `keyed-test:role:${run}`;
    await createKeyed(key);
    await expect(createKeyed(key, 'engineer')).rejects.toThrow(/→ 409/);
    expect(await rowsHolding(key)).toHaveLength(1);
  });

  it('a row created without a key is never matched by a keyed create', async () => {
    const plain = await api.post('/api/escalations', { type: 'keyed-test', role: ROLE, description: 'plain row' });
    const keyed = await createKeyed(`keyed-test:plain:${run}`);
    expect(keyed.status).toBe(201);
    expect(keyed.data.id).not.toBe(plain.data.id);
  });
});
