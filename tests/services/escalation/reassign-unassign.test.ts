import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  createEscalation,
  claimEscalation,
  getEscalation,
  cancelEscalation,
  bulkReassignEscalations,
  bulkUnassignEscalations,
} from '../../../services/escalation';
import { ensureEscalationCompatView } from '../../../services/escalation/client';

// Reassign hands a pending row to a user INCLUDING rows under a live claim
// (the management override plain assign is not); unassign returns claimed
// rows to the pool. Both are one guarded statement — terminal rows are
// skipped, and each change carries the pre-update assignee for the event.

const ROLE = `reassign-role-${Date.now()}`;
const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';

async function seedRow(desc: string): Promise<string> {
  const esc = await createEscalation({
    type: 'test',
    subtype: 'reassign',
    role: ROLE,
    description: desc,
    priority: 2,
    envelope: '{}',
  } as any);
  return esc.id;
}

describe('escalation service — reassign / unassign', () => {
  beforeAll(async () => {
    await migrate();
    await ensureEscalationCompatView();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM public.hmsh_escalations WHERE role = $1", [ROLE]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('takes over a LIVE claim atomically, capturing the displaced assignee', async () => {
    const id = await seedRow('live claim takeover');
    await claimEscalation(id, USER_A, 60);

    const result = await bulkReassignEscalations([id], USER_B, 45);
    expect(result.assigned).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.changes[0]).toMatchObject({ id, role: ROLE, prior_assignee: USER_A });

    const row = await getEscalation(id);
    expect(row?.assigned_to).toBe(USER_B);
    expect(new Date(row!.assigned_until!).getTime()).toBeGreaterThan(Date.now() + 40 * 60_000);
  });

  it('reassigns unclaimed rows too (superset of assign), prior assignee null', async () => {
    const id = await seedRow('unclaimed reassign');
    const result = await bulkReassignEscalations([id], USER_B, 30);
    expect(result.assigned).toBe(1);
    expect(result.changes[0].prior_assignee).toBeNull();
    expect((await getEscalation(id))?.assigned_to).toBe(USER_B);
  });

  it('unassign returns a claimed row to the pool, clearing every claim field', async () => {
    const id = await seedRow('unassign target');
    await claimEscalation(id, USER_A, 60);

    const result = await bulkUnassignEscalations([id]);
    expect(result.unassigned).toBe(1);
    expect(result.changes[0].prior_assignee).toBe(USER_A);

    const row = await getEscalation(id);
    expect(row?.assigned_to).toBeNull();
    expect(row?.assigned_until).toBeNull();
    expect(row?.claimed_at).toBeNull();
    expect(row?.status).toBe('pending');
  });

  it('terminal rows are skipped by both verbs; unclaimed rows skip unassign', async () => {
    const cancelledId = await seedRow('terminal row');
    await cancelEscalation(cancelledId);
    const unclaimedId = await seedRow('never claimed');

    const reassign = await bulkReassignEscalations([cancelledId], USER_B, 30);
    expect(reassign).toMatchObject({ assigned: 0, skipped: 1 });
    expect((await getEscalation(cancelledId))?.assigned_to ?? null).toBeNull();

    const unassign = await bulkUnassignEscalations([cancelledId, unclaimedId]);
    expect(unassign).toMatchObject({ unassigned: 0, skipped: 2 });
  });
});
