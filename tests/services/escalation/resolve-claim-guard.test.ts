import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as escalationService from '../../../services/escalation';
import * as roleService from '../../../services/role';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// resolveEscalation assertClaim — against real Postgres.
//
// Contract: the 4th argument threads the SDK's `assertClaim` into the guarded
// resolve UPDATE. A claim is a lock only while its TTL window is active — the
// assertion blocks exactly a live window held by another user and the caller's
// own lapsed window. Unclaimed rows, durable pre-assignments (assigned_to with
// no window), and lapsed windows under a different user resolve normally.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `claim-guard-${Date.now()}`;
const ME = 'guard-me';
const OTHER = 'guard-other';
const createdIds: string[] = [];

async function seed(i: number): Promise<string> {
  const rec = await escalationService.createEscalation({
    type: 'claim-guard-case',
    role: ROLE,
    envelope: '{}',
    description: `claim guard row ${i}`,
    metadata: { unit: `cg${i}` },
  });
  createdIds.push(rec.id);
  return rec.id;
}

async function lapseWindow(id: string): Promise<void> {
  await getPool().query(
    `UPDATE public.hmsh_escalations
     SET assigned_until = NOW() - INTERVAL '1 minute'
     WHERE id = $1`,
    [id],
  );
}

const expectStatus = async (id: string, status: string) => {
  const row = await escalationService.getEscalation(id);
  expect(row).toBeTruthy();
  expect(row!.status).toBe(status);
};

describe('resolveEscalation assertClaim (integration)', () => {
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

  it('resolves under a live claim held by the asserting user', async () => {
    const id = await seed(1);
    await escalationService.claimEscalation(id, ME, 30);

    const resolved = await escalationService.resolveEscalation(id, { ok: true }, undefined, ME);
    expect(resolved).toBeTruthy();
    await expectStatus(id, 'resolved');
  });

  it('blocks the caller\'s own lapsed window — the stale claimant cannot land a resolution', async () => {
    const id = await seed(2);
    await escalationService.claimEscalation(id, ME, 30);
    await lapseWindow(id);

    const blocked = await escalationService.resolveEscalation(id, { ok: true }, undefined, ME);
    expect(blocked).toBeNull();
    await expectStatus(id, 'pending');

    // Recovery: re-claim restarts the window, then the resolve lands
    await escalationService.claimEscalation(id, ME, 30);
    const resolved = await escalationService.resolveEscalation(id, { ok: true }, undefined, ME);
    expect(resolved).toBeTruthy();
    await expectStatus(id, 'resolved');
  });

  it('blocks a live window held by another user', async () => {
    const id = await seed(3);
    await escalationService.claimEscalation(id, OTHER, 30);

    const blocked = await escalationService.resolveEscalation(id, { ok: true }, undefined, ME);
    expect(blocked).toBeNull();
    await expectStatus(id, 'pending');
  });

  it('resolves an unclaimed row — system semantics preserved under assertion', async () => {
    const id = await seed(4);
    const resolved = await escalationService.resolveEscalation(id, { ok: true }, undefined, ME);
    expect(resolved).toBeTruthy();
    await expectStatus(id, 'resolved');
  });

  it('resolves a durable pre-assignment (assigned_to with no window) — routing, not a lock', async () => {
    const id = await seed(5);
    await getPool().query(
      `UPDATE public.hmsh_escalations
       SET assigned_to = $2, assigned_until = NULL
       WHERE id = $1`,
      [id, ME],
    );

    const resolved = await escalationService.resolveEscalation(id, { ok: true }, undefined, ME);
    expect(resolved).toBeTruthy();
    await expectStatus(id, 'resolved');
  });

  it('resolves when another user\'s window has lapsed — the lock is gone', async () => {
    const id = await seed(6);
    await escalationService.claimEscalation(id, OTHER, 30);
    await lapseWindow(id);

    const resolved = await escalationService.resolveEscalation(id, { ok: true }, undefined, ME);
    expect(resolved).toBeTruthy();
    await expectStatus(id, 'resolved');
  });

  it('omitting assertClaim keeps claim-agnostic semantics — a lapsed claim does not block system resolves', async () => {
    const id = await seed(7);
    await escalationService.claimEscalation(id, ME, 30);
    await lapseWindow(id);

    const resolved = await escalationService.resolveEscalation(id, { ok: true });
    expect(resolved).toBeTruthy();
    await expectStatus(id, 'resolved');
  });
});
