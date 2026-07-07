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
// resolveMany × waiter rows — against real Postgres (hotmesh 0.25.6).
//
// Contract: bulk resolution (`resolveMany`) is UPDATE-only and must never
// settle a row that backs a live `condition()` waiter (`signal_key IS NOT
// NULL`) — a settled status implies the waiter's wake was delivered, which
// only the targeted `resolve()`/`cancel()` can guarantee. The store enforces
// this: waiter rows are skipped by the bulk UPDATE, stay `pending`, and are
// excluded from the return set (and therefore from endpoint counts).
//
// Consumers pinned here: `resolveEscalationsByIds` (bulk ack) and
// `bulkResolveForTriage` (the bulkTriage endpoint) — both may receive a
// mixed id set from the operator UI, which does not filter waiter rows.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `waiter-excl-${Date.now()}`;
const createdIds: string[] = [];

async function seedStandalone(i: number): Promise<string> {
  const rec = await escalationService.createEscalation({
    type: 'waiter-excl-case',
    subtype: 'standalone',
    role: ROLE,
    envelope: '{}',
    description: `standalone row ${i}`,
    metadata: { order_id: `${ROLE}-s${i}` },
  });
  createdIds.push(rec.id);
  return rec.id;
}

async function seedWaiter(i: number): Promise<string> {
  const client = await escalations();
  const entry = await client.create({
    signalKey: `sig-${ROLE}-${i}`,
    type: 'waiter-excl-case',
    subtype: 'waiter',
    role: ROLE,
    description: `condition() waiter row ${i}`,
    priority: 2,
  });
  createdIds.push(entry.id);
  return entry.id;
}

const expectPending = async (id: string) => {
  const row = await escalationService.getEscalation(id);
  expect(row).toBeTruthy();
  expect(row!.status).toBe('pending');
};

describe('resolveMany excludes live waiter rows (integration)', () => {
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

  it('resolveEscalationsByIds on a mixed set: standalone rows settle, the waiter stays pending', async () => {
    const standaloneId = await seedStandalone(1);
    const waiterId = await seedWaiter(1);

    const resolved = await escalationService.resolveEscalationsByIds(
      [standaloneId, waiterId],
      { swept: true },
    );

    expect(resolved.map((r) => r.id)).toEqual([standaloneId]);
    await expectPending(waiterId);
  });

  it('resolveEscalationsByIds on a waiter-only set resolves nothing', async () => {
    const waiterId = await seedWaiter(2);

    const resolved = await escalationService.resolveEscalationsByIds(
      [waiterId],
      { swept: true },
    );

    expect(resolved).toEqual([]);
    await expectPending(waiterId);
  });

  it('bulkResolveForTriage on a mixed set: only the standalone row enters triage', async () => {
    const standaloneId = await seedStandalone(2);
    const waiterId = await seedWaiter(3);

    const resolved = await escalationService.bulkResolveForTriage([standaloneId, waiterId]);

    expect(resolved.map((r) => r.id)).toEqual([standaloneId]);
    await expectPending(waiterId);
  });

  it('a skipped waiter remains resolvable by the targeted per-row resolve', async () => {
    const waiterId = await seedWaiter(4);

    await escalationService.resolveEscalationsByIds([waiterId], { swept: true });
    await expectPending(waiterId);

    // The targeted path carries the wake. With no live workflow parked on the
    // signal the wake enqueue falls back benignly; the row itself must settle.
    const resolved = await escalationService.resolveEscalation(waiterId, { approved: true });
    expect(resolved).toBeTruthy();
    expect(resolved!.status).toBe('resolved');
  });
});
