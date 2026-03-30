import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4620);

describe('Control plane routes', () => {
  describe('GET /api/controlplane/apps', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/apps`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role (admin-only)', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/apps`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(403);
    });

    it('returns apps array for admin', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/apps`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('apps');
      expect(Array.isArray(body.apps)).toBe(true);
    });
  });

  describe('GET /api/controlplane/rollcall', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/rollcall`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/rollcall`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(403);
    });

    it('returns profiles for admin', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/rollcall`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('profiles');
    });
  });

  describe('POST /api/controlplane/throttle', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/throttle`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/throttle`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ throttle: 0 }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 when throttle field is missing', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/throttle`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('throttle');
    });

    it('returns 400 when throttle is not a number', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/throttle`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ throttle: 'fast' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('throttle');
    });
  });

  describe('GET /api/controlplane/streams', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/streams`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/streams`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(403);
    });

    it('returns stats object for admin', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/streams`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body).toBe('object');
    });
  });

  describe('POST /api/controlplane/subscribe', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/subscribe`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/subscribe`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ appId: 'durable' }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 200 with subscribed true for admin', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/subscribe`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ appId: 'durable' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.subscribed).toBe(true);
    });
  });
});
