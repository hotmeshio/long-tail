import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';

const ctx = setupRouteTest(4647);

// Reassign (bulk-assign { reassign: true }) takes over live claims; unassign
// returns them to the pool. Both are admin overrides — members are refused.

const ROLE = `route-reassign-${Date.now()}`;

describe('reassign / unassign routes', () => {
  let escalationId: string;

  beforeAll(async () => {
    const res = await fetch(`${ctx.BASE}/escalations`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ type: 'test', role: ROLE, description: 'route reassign fixture' }),
    });
    expect(res.status).toBe(201);
    escalationId = (await res.json()).id;

    const claim = await fetch(`${ctx.BASE}/escalations/${escalationId}/claim`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ durationMinutes: 60 }),
    });
    expect(claim.status).toBe(200);
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM public.hmsh_escalations WHERE role = $1', [ROLE]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('plain bulk-assign skips the live claim; reassign takes it over', async () => {
    const target = '00000000-0000-4000-8000-0000000000c1';
    const plain = await fetch(`${ctx.BASE}/escalations/bulk-assign`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ ids: [escalationId], targetUserId: target }),
    });
    expect(plain.status).toBe(200);
    expect(await plain.json()).toEqual({ assigned: 0, skipped: 1 });

    const takeover = await fetch(`${ctx.BASE}/escalations/bulk-assign`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ ids: [escalationId], targetUserId: target, reassign: true }),
    });
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toEqual({ assigned: 1, skipped: 0 });

    const row = await (await fetch(`${ctx.BASE}/escalations/${escalationId}`, {
      headers: authHeaders(ctx.builderToken),
    })).json();
    expect(row.assigned_to).toBe(target);
  });

  it('a member cannot reassign or unassign', async () => {
    const reassign = await fetch(`${ctx.BASE}/escalations/bulk-assign`, {
      method: 'POST',
      headers: authHeaders(ctx.memberToken),
      body: JSON.stringify({ ids: [escalationId], targetUserId: 'u2', reassign: true }),
    });
    expect(reassign.status).toBe(403);

    const unassign = await fetch(`${ctx.BASE}/escalations/bulk-unassign`, {
      method: 'POST',
      headers: authHeaders(ctx.memberToken),
      body: JSON.stringify({ ids: [escalationId] }),
    });
    expect(unassign.status).toBe(403);
  });

  it('unassign returns the row to the available pool', async () => {
    const res = await fetch(`${ctx.BASE}/escalations/bulk-unassign`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ ids: [escalationId] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unassigned: 1, skipped: 0 });

    const row = await (await fetch(`${ctx.BASE}/escalations/${escalationId}`, {
      headers: authHeaders(ctx.builderToken),
    })).json();
    expect(row.assigned_to).toBeNull();
    expect(row.status).toBe('pending');
  });
});
