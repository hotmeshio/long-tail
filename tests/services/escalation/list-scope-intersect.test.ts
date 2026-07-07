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
// Role filter × read scope — the plain (SDK) list path, against real Postgres.
//
// Regression: the plain path passed BOTH `role` (explicit filter) and `roles`
// (read scope) to the SDK store, whose `roles[]` takes precedence — for a
// scoped (non-global) caller the explicit role filter was silently dropped
// and the scope's rows came back under a role-filtered query. Reported by a
// dependent as role-filtered in-process scans "seeing an empty pond".
//
// Contract (mirrors the faceted path): a role filter can only NARROW within
// scope. In-scope role → that role's rows only; out-of-scope role → empty;
// global caller (no visibleRoles) → role filter honored as-is.
// ─────────────────────────────────────────────────────────────────────────────

const A = `scope-int-a-${Date.now()}`;
const B = `scope-int-b-${Date.now()}`;
const createdIds: string[] = [];

async function seedEscalation(role: string, i: number): Promise<void> {
  const rec = await escalationService.createEscalation({
    type: 'scope-intersect-case',
    subtype: 'scope-case',
    role,
    envelope: '{}',
    description: `${role} row ${i}`,
    metadata: { order_id: `${role}-${i}` },
  });
  createdIds.push(rec.id);
}

const rowRoles = (r: { escalations: { role: string }[] }) =>
  [...new Set(r.escalations.map((e) => e.role))];

describe('list role filter intersects read scope (integration)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await roleService.createRole(A);
    await roleService.createRole(B);
    for (let i = 0; i < 2; i++) {
      await seedEscalation(A, i);
      await seedEscalation(B, i);
    }
  }, 60_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    await pool.query('DELETE FROM lt_roles WHERE role IN ($1, $2)', [A, B]);
  });

  it('global caller (no scope): role filter is honored', async () => {
    const r = await escalationService.listEscalations({ status: 'pending', role: A });
    expect(r.total).toBe(2);
    expect(rowRoles(r)).toEqual([A]);
  });

  it('scoped caller, in-scope role: only that role comes back — the filter is not dropped', async () => {
    const r = await escalationService.listEscalations({
      status: 'pending', role: A, visibleRoles: [A, B],
    });
    expect(r.total).toBe(2);
    expect(rowRoles(r)).toEqual([A]);
  });

  it('scoped caller, out-of-scope role: empty — never another role\'s rows', async () => {
    const r = await escalationService.listEscalations({
      status: 'pending', role: A, visibleRoles: [B],
    });
    expect(r.total).toBe(0);
    expect(r.escalations).toEqual([]);
  });

  it('scoped caller, no role filter: scope alone bounds the result', async () => {
    const r = await escalationService.listEscalations({
      status: 'pending', visibleRoles: [B],
    });
    expect(r.total).toBe(2);
    expect(rowRoles(r)).toEqual([B]);
  });

  it('listAvailable: in-scope role narrows, out-of-scope role is empty', async () => {
    const inScope = await escalationService.listAvailableEscalations({
      role: A, visibleRoles: [A, B],
    });
    expect(inScope.total).toBe(2);
    expect(rowRoles(inScope)).toEqual([A]);

    const outOfScope = await escalationService.listAvailableEscalations({
      role: A, visibleRoles: [B],
    });
    expect(outOfScope.total).toBe(0);
  });
});
