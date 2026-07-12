import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as escalationService from '../../../services/escalation';
import { escalations } from '../../../services/escalation/client';
import * as roleService from '../../../services/role';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// resolveEscalationsAllOrNone — against real Postgres (hotmesh 0.26.1).
//
// Contract: every listed row resolves, each with its OWN resolverPayload, in
// one atomic statement — or nothing resolves. Unlike `resolveEscalationsByIds`
// (UPDATE-only, skips waiter rows), rows backing a live `condition()` waiter
// are first-class: the statement commits each waiter's wake with its resolve.
// On failure `failed` names exactly the blocking rows; resolvable members stay
// pending, untouched — the set is intact for a retry.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `all-or-none-${Date.now()}`;
const createdIds: string[] = [];

async function seedStandalone(i: number): Promise<string> {
  const rec = await escalationService.createEscalation({
    type: 'all-or-none-case',
    subtype: 'standalone',
    role: ROLE,
    envelope: '{}',
    description: `standalone row ${i}`,
    metadata: { unit: `s${i}` },
  });
  createdIds.push(rec.id);
  return rec.id;
}

async function seedWaiter(i: number): Promise<string> {
  const client = await escalations();
  const entry = await client.create({
    signalKey: `sig-${ROLE}-${i}`,
    type: 'all-or-none-case',
    subtype: 'waiter',
    role: ROLE,
    description: `condition() waiter row ${i}`,
    priority: 2,
  });
  createdIds.push(entry.id);
  return entry.id;
}

const expectStatus = async (id: string, status: string) => {
  const row = await escalationService.getEscalation(id);
  expect(row).toBeTruthy();
  expect(row!.status).toBe(status);
};

describe('resolveEscalationsAllOrNone (integration)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await roleService.createRole(ROLE);
  }, 60_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('mixed set: every row resolves atomically, each with its own payload — waiters included', async () => {
    const standaloneId = await seedStandalone(1);
    const waiterId = await seedWaiter(1);

    const result = await escalationService.resolveEscalationsAllOrNone([
      { id: standaloneId, resolverPayload: { mandate: 'standalone' } },
      { id: waiterId, resolverPayload: { mandate: 'waiter', gcodeRef: 'gcode-w1' } },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.escalations.map((r) => r.id).sort()).toEqual([standaloneId, waiterId].sort());

    // each row stored ITS OWN payload — the audit record of what was delivered
    const standalone = await escalationService.getEscalation(standaloneId);
    const waiter = await escalationService.getEscalation(waiterId);
    expect(standalone!.status).toBe('resolved');
    expect(waiter!.status).toBe('resolved');
    expect(JSON.parse(standalone!.resolver_payload!).mandate).toBe('standalone');
    const waiterPayload = JSON.parse(waiter!.resolver_payload!);
    expect(waiterPayload.mandate).toBe('waiter');
    expect(waiterPayload.gcodeRef).toBe('gcode-w1');
  });

  it('a terminal member blocks the batch; nothing is written', async () => {
    const openId = await seedStandalone(2);
    const doneId = await seedStandalone(3);
    await escalationService.resolveEscalation(doneId, { first: true });

    const result = await escalationService.resolveEscalationsAllOrNone([
      { id: openId, resolverPayload: { second: true } },
      { id: doneId, resolverPayload: { second: true } },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // only the true blocker is named — the resolvable member is not listed
    expect(result.failed).toEqual([{ id: doneId, reason: 'already-resolved' }]);
    await expectStatus(openId, 'pending');
    // the loser wrote nothing: the winner's payload is intact
    const done = await escalationService.getEscalation(doneId);
    const donePayload = JSON.parse(done!.resolver_payload!);
    expect(donePayload.first).toBe(true);
    expect(donePayload.second).toBeUndefined();
  });

  it('an unknown id blocks the batch with not-found', async () => {
    const openId = await seedStandalone(4);
    const missing = '00000000-0000-4000-8000-000000000000';

    const result = await escalationService.resolveEscalationsAllOrNone([
      { id: openId, resolverPayload: { ok: true } },
      { id: missing, resolverPayload: { ok: true } },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failed).toEqual([{ id: missing, reason: 'not-found' }]);
    await expectStatus(openId, 'pending');
  });

  it('assertAssignee: a member held by another principal blocks the batch', async () => {
    const mineId = await seedStandalone(5);
    const theirsId = await seedStandalone(6);
    await escalationService.claimEscalation(mineId, 'broker-1', 5);
    await escalationService.claimEscalation(theirsId, 'broker-2', 5);

    const blocked = await escalationService.resolveEscalationsAllOrNone(
      [
        { id: mineId, resolverPayload: { n: 1 } },
        { id: theirsId, resolverPayload: { n: 2 } },
      ],
      undefined,
      'broker-1',
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.failed).toEqual([{ id: theirsId, reason: 'assignee-mismatch' }]);
    await expectStatus(mineId, 'pending');
    await expectStatus(theirsId, 'pending');

    // holder-consistent batch resolves
    const resolved = await escalationService.resolveEscalationsAllOrNone(
      [{ id: mineId, resolverPayload: { n: 1 } }],
      undefined,
      'broker-1',
    );
    expect(resolved.ok).toBe(true);
  });

  it('shared metadata patch merges into every row alongside per-row payloads', async () => {
    const aId = await seedStandalone(7);
    const bId = await seedStandalone(8);

    const result = await escalationService.resolveEscalationsAllOrNone(
      [
        { id: aId, resolverPayload: { unit: 'a' } },
        { id: bId, resolverPayload: { unit: 'b' } },
      ],
      { outcome: 'gang-complete' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const rec of result.escalations) {
      expect((rec.metadata as any).outcome).toBe('gang-complete');
    }
  });

  it('empty items resolves nothing and succeeds', async () => {
    const result = await escalationService.resolveEscalationsAllOrNone([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.escalations).toEqual([]);
  });
});
