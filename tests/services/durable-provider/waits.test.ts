import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { openWait, getWaitByEscalationId } from '../../../services/durable-provider';
import * as escalationService from '../../../services/escalation';

const { Connection } = Durable;
const PROVIDER = 'waits-test';
const CREATOR = '00000000-0000-4000-8000-0000000000aa';

function waitInput(workflowId: string, waitKey = 'review') {
  return {
    workflowId,
    runScope: 'run-1',
    workflowType: 'reviewOrder',
    waitKey,
    role: 'reviewer',
    type: 'order-review',
    metadata: { orderId: workflowId },
    data: { note: 'check it' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe('durable provider waits', () => {
  const runId = `w-${Date.now()}`;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE provider = $1)`, [PROVIDER]);
    await pool.query('DELETE FROM lt_durable_waits WHERE provider = $1', [PROVIDER]);
    await Durable.shutdown();
  });

  it('creates the escalation once and returns it on repeat', async () => {
    const first = await openWait(PROVIDER, waitInput(`${runId}-a`), CREATOR);
    const second = await openWait(PROVIDER, waitInput(`${runId}-a`), CREATOR);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.escalation.id).toBe(first.escalation.id);
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM lt_durable_waits WHERE workflow_id = $1', [`${runId}-a`]);
    expect(rows[0].n).toBe(1);
  });

  it('writes a row the SDK resolve never wakes: no signal_key, no task_queue', async () => {
    const { escalation } = await openWait(PROVIDER, waitInput(`${runId}-b`), CREATOR);
    expect(escalation.signal_key).toBeFalsy();
    expect(escalation.task_queue).toBeFalsy();
    expect(escalation.workflow_id).toBe(`${runId}-b`);
    expect(escalation.workflow_type).toBe('reviewOrder');
    expect(escalation.role).toBe('reviewer');
    expect(escalation.status).toBe('pending');
    expect(escalation.metadata).toMatchObject({ orderId: `${runId}-b` });
  });

  it('opens separate waits for separate keys and run scopes', async () => {
    const a = await openWait(PROVIDER, waitInput(`${runId}-c`, 'k1'), CREATOR);
    const b = await openWait(PROVIDER, waitInput(`${runId}-c`, 'k2'), CREATOR);
    const c = await openWait(PROVIDER, { ...waitInput(`${runId}-c`, 'k1'), runScope: 'run-2' }, CREATOR);
    expect(new Set([a.escalation.id, b.escalation.id, c.escalation.id]).size).toBe(3);
  });

  it('agrees on one row under concurrent opens of the same key', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => openWait(PROVIDER, waitInput(`${runId}-d`), CREATOR)),
    );
    expect(new Set(results.map((r) => r.escalation.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('clears delivery when a delivered wait is opened again', async () => {
    const { escalation } = await openWait(PROVIDER, waitInput(`${runId}-e`), CREATOR);
    await escalationService.resolveEscalation(escalation.id, { approved: true });
    await getPool().query(`UPDATE lt_durable_waits SET delivered_at = NOW(), delivery = 'delivered' WHERE escalation_id = $1`, [escalation.id]);
    const again = await openWait(PROVIDER, waitInput(`${runId}-e`), CREATOR);
    expect(again.reopened).toBe(true);
    expect(again.escalation.status).toBe('resolved');
    const wait = await getWaitByEscalationId(escalation.id);
    expect(wait?.delivered_at).toBeNull();
  });

  it('returns null for an escalation that is not a wait, and for a malformed id', async () => {
    expect(await getWaitByEscalationId('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(await getWaitByEscalationId('not-a-uuid')).toBeNull();
  });
});
