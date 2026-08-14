import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';

const ctx = setupRouteTest(4646);

// LIST rows omit the two heavyweight JSON columns (envelope,
// escalation_payload) by default; ?include=envelope restores both. The
// single-item GET always carries the full record.

const ROLE = `slim-list-role-${Date.now()}`;
const ENVELOPE = { data: { order: 'ORD-9', bulk: 'x'.repeat(200) } };

describe('escalation list slimming', () => {
  let escalationId: string;

  beforeAll(async () => {
    const res = await fetch(`${ctx.BASE}/escalations`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({
        type: 'slimListCheck',
        role: ROLE,
        description: 'slim list fixture',
        envelope: JSON.stringify(ENVELOPE),
        escalation_payload: JSON.stringify({ note: 'heavy too' }),
        metadata: { order: 'ORD-9' },
      }),
    });
    expect(res.status).toBe(201);
    escalationId = (await res.json()).id;
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM hmsh_escalations WHERE role = $1', [ROLE]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('list rows are slim by default but keep metadata and resolver_payload keys', async () => {
    const res = await fetch(`${ctx.BASE}/escalations?role=${ROLE}`, {
      headers: authHeaders(ctx.builderToken),
    });
    expect(res.status).toBe(200);
    const row = (await res.json()).escalations.find((e: any) => e.id === escalationId);
    expect(row).toBeDefined();
    expect('envelope' in row).toBe(false);
    expect('escalation_payload' in row).toBe(false);
    expect(row.metadata).toEqual({ order: 'ORD-9' });
    expect('resolver_payload' in row).toBe(true);
  });

  it('?include=envelope restores both columns', async () => {
    const res = await fetch(`${ctx.BASE}/escalations?role=${ROLE}&include=envelope`, {
      headers: authHeaders(ctx.builderToken),
    });
    const row = (await res.json()).escalations.find((e: any) => e.id === escalationId);
    expect(JSON.parse(row.envelope)).toEqual(ENVELOPE);
    expect(JSON.parse(row.escalation_payload)).toEqual({ note: 'heavy too' });
  });

  it('the available list slims and restores the same way', async () => {
    const slim = await fetch(`${ctx.BASE}/escalations/available?role=${ROLE}`, {
      headers: authHeaders(ctx.builderToken),
    });
    const slimRow = (await slim.json()).escalations.find((e: any) => e.id === escalationId);
    expect(slimRow).toBeDefined();
    expect('envelope' in slimRow).toBe(false);

    const fat = await fetch(`${ctx.BASE}/escalations/available?role=${ROLE}&include=envelope`, {
      headers: authHeaders(ctx.builderToken),
    });
    const fatRow = (await fat.json()).escalations.find((e: any) => e.id === escalationId);
    expect(JSON.parse(fatRow.envelope)).toEqual(ENVELOPE);
  });

  it('the single-item GET always carries the full record', async () => {
    const res = await fetch(`${ctx.BASE}/escalations/${escalationId}`, {
      headers: authHeaders(ctx.builderToken),
    });
    const esc = await res.json();
    expect(JSON.parse(esc.envelope)).toEqual(ENVELOPE);
  });
});
