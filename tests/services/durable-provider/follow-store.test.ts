import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { claimDueFollows, recordFollow, removeFollow, FOLLOW_DEFAULTS } from '../../../services/durable-provider';

const PROVIDER = 'follow-store-test';

async function row(workflowId: string) {
  const { rows } = await getPool().query(
    `SELECT workflow_type, checks, EXTRACT(EPOCH FROM (next_check_at - NOW())) * 1000 AS due_in_ms
     FROM lt_durable_follows WHERE provider = $1 AND workflow_id = $2`, [PROVIDER, workflowId]);
  return rows[0] as { workflow_type: string | null; checks: number; due_in_ms: number } | undefined;
}

async function makeDue(workflowId: string, checks = 0) {
  await getPool().query(
    `UPDATE lt_durable_follows SET next_check_at = NOW() - INTERVAL '1 second', checks = $3 WHERE provider = $1 AND workflow_id = $2`,
    [PROVIDER, workflowId, checks]);
}

describe('durable follow store', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  beforeEach(async () => { await getPool().query('DELETE FROM lt_durable_follows WHERE provider = $1', [PROVIDER]); });
  afterAll(async () => {
    await getPool().query('DELETE FROM lt_durable_follows WHERE provider = $1', [PROVIDER]);
  });

  it('records a follow first checked after the sweep delay', async () => {
    expect(await recordFollow(PROVIDER, 'wf-1', 'reviewOrder')).toBe(true);
    const stored = await row('wf-1');
    expect(stored).toMatchObject({ workflow_type: 'reviewOrder', checks: 0 });
    expect(Number(stored!.due_in_ms)).toBeGreaterThan(FOLLOW_DEFAULTS.SWEEP_AFTER_MS - 5_000);
    expect(await claimDueFollows(PROVIDER)).toEqual([]);
  });

  it('a repeat restarts the checks and keeps the known workflow type', async () => {
    await recordFollow(PROVIDER, 'wf-2', 'reviewOrder');
    await makeDue('wf-2', 7);
    expect(await recordFollow(PROVIDER, 'wf-2', '')).toBe(false);
    const stored = await row('wf-2');
    expect(stored).toMatchObject({ workflow_type: 'reviewOrder', checks: 0 });
    expect(Number(stored!.due_in_ms)).toBeGreaterThan(0);
  });

  it('claims due follows oldest first, up to the batch, and moves each out by a doubling delay', async () => {
    for (const id of ['wf-a', 'wf-b', 'wf-c']) await recordFollow(PROVIDER, id, 't');
    await makeDue('wf-a', 0);
    await makeDue('wf-b', 2);
    await getPool().query(`UPDATE lt_durable_follows SET next_check_at = NOW() - INTERVAL '1 hour' WHERE provider = $1 AND workflow_id = 'wf-b'`, [PROVIDER]);
    expect((await claimDueFollows(PROVIDER, 1)).map((f) => f.workflow_id)).toEqual(['wf-b']);
    expect((await claimDueFollows(PROVIDER)).map((f) => f.workflow_id)).toEqual(['wf-a']);
    const [a, b] = [await row('wf-a'), await row('wf-b')];
    expect(a!.checks).toBe(1);
    expect(b!.checks).toBe(3);
    expect(Math.round(Number(a!.due_in_ms) / 1000)).toBe(FOLLOW_DEFAULTS.SWEEP_AFTER_MS / 1000);
    expect(Math.round(Number(b!.due_in_ms) / 1000)).toBe((FOLLOW_DEFAULTS.SWEEP_AFTER_MS * 4) / 1000);
  });

  it('caps the delay between checks', async () => {
    await recordFollow(PROVIDER, 'wf-old', 't');
    await makeDue('wf-old', 500);
    await claimDueFollows(PROVIDER);
    expect(Math.round(Number((await row('wf-old'))!.due_in_ms) / 1000)).toBe(FOLLOW_DEFAULTS.SWEEP_BACKOFF_MAX_MS / 1000);
  });

  it('concurrent claims take each follow once', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `wf-race-${i}`);
    for (const id of ids) { await recordFollow(PROVIDER, id, 't'); await makeDue(id); }
    const claims = await Promise.all([claimDueFollows(PROVIDER), claimDueFollows(PROVIDER), claimDueFollows(PROVIDER)]);
    expect(claims.flat().map((f) => f.workflow_id).sort()).toEqual([...ids].sort());
  });

  it('removes a follow for one caller and scopes it to the provider', async () => {
    await recordFollow(PROVIDER, 'wf-3', 'reviewOrder');
    expect(await removeFollow('another-provider', 'wf-3')).toBeNull();
    const removed = await Promise.all([removeFollow(PROVIDER, 'wf-3'), removeFollow(PROVIDER, 'wf-3')]);
    expect(removed.filter(Boolean)).toEqual([{ workflow_type: 'reviewOrder' }]);
  });
});
