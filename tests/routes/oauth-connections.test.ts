import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4632);

describe('OAuth connections route', () => {
  it('GET /api/auth/oauth/connections returns 401 without auth', async () => {
    const res = await fetch(`${ctx.BASE}/auth/oauth/connections`);
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/oauth/connections returns connections array', async () => {
    const res = await fetch(`${ctx.BASE}/auth/oauth/connections`, {
      headers: authHeaders(ctx.adminToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('connections');
    expect(Array.isArray(body.connections)).toBe(true);
  });

  it('GET /api/auth/oauth/connections returns empty for user with no connections', async () => {
    const res = await fetch(`${ctx.BASE}/auth/oauth/connections`, {
      headers: authHeaders(ctx.memberToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.connections).toEqual([]);
  });
});
