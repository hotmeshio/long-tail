import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';
import * as roleService from '../../services/role';

// GET /api/roles/:role/schema and /schema/versions — the versioned role-schema
// read surface the resolver UI and pinned escalations depend on.

const ctx = setupRouteTest(4643);

const ROLE = `route-schema-role-${Date.now()}`;
const FORM = { type: 'object', properties: { approved: { type: 'boolean' } } };

describe('Role schema routes', () => {
  beforeAll(async () => {
    await roleService.createRole(ROLE);
    await roleService.updateRoleMetadata(ROLE, { form_schema: FORM });
  });

  afterAll(async () => {
    const { getPool } = await import('../../lib/db');
    await getPool().query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('returns 401 without auth', async () => {
    const res = await fetch(`${ctx.BASE}/roles/${ROLE}/schema`);
    expect(res.status).toBe(401);
  });

  it('returns the latest schema with its current version', async () => {
    const res = await fetch(`${ctx.BASE}/roles/${ROLE}/schema`, {
      headers: authHeaders(ctx.memberToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.version).toBe(1);
    expect(body.latest_version).toBe(1);
    expect(body.form_schema).toEqual(FORM);
  });

  it('returns a pinned snapshot via ?version=', async () => {
    const res = await fetch(`${ctx.BASE}/roles/${ROLE}/schema?version=1`, {
      headers: authHeaders(ctx.memberToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.version).toBe(1);
    expect(body.form_schema).toEqual(FORM);
  });

  it('404s a missing version instead of falling back to latest', async () => {
    const res = await fetch(`${ctx.BASE}/roles/${ROLE}/schema?version=42`, {
      headers: authHeaders(ctx.memberToken),
    });
    expect(res.status).toBe(404);
  });

  it('400s a non-integer version', async () => {
    const res = await fetch(`${ctx.BASE}/roles/${ROLE}/schema?version=abc`, {
      headers: authHeaders(ctx.memberToken),
    });
    expect(res.status).toBe(400);
  });

  it('404s an unknown role', async () => {
    const res = await fetch(`${ctx.BASE}/roles/no-such-role/schema`, {
      headers: authHeaders(ctx.memberToken),
    });
    expect(res.status).toBe(404);
  });

  it('lists the version history newest first', async () => {
    const res = await fetch(`${ctx.BASE}/roles/${ROLE}/schema/versions`, {
      headers: authHeaders(ctx.memberToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.versions)).toBe(true);
    expect(body.versions[0].version).toBe(1);
    expect(body.versions[0].is_current).toBe(true);
  });
});
