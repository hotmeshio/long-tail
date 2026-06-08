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
        headers: authHeaders(ctx.builderToken),
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
        headers: authHeaders(ctx.builderToken),
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
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('throttle');
    });

    it('returns 400 when throttle is not a number', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/throttle`, {
        method: 'POST',
        headers: authHeaders(ctx.builderToken),
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
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body).toBe('object');
    });
  });

  describe('GET /api/controlplane/stream-messages', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=worker`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=worker`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 when namespace is missing', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?source=worker`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('namespace');
    });

    it('returns 400 when source is missing', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('source');
    });

    it('returns 400 when source is invalid', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=both`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('source');
    });

    it('returns messages array and total for admin (worker)', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=worker`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('messages');
      expect(Array.isArray(body.messages)).toBe(true);
      expect(typeof body.total).toBe('number');
      for (const msg of body.messages) {
        expect(msg.source).toBe('worker');
      }
    });

    it('returns messages array and total for admin (engine)', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=engine`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('messages');
      expect(Array.isArray(body.messages)).toBe(true);
      for (const msg of body.messages) {
        expect(msg.source).toBe('engine');
      }
    });

    it('respects limit and offset parameters', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=worker&limit=5&offset=0`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.messages.length).toBeLessThanOrEqual(5);
    });

    it('filters by status', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=worker&status=processed`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      for (const msg of body.messages) {
        expect(msg.status).toBe('processed');
      }
    });

    it('supports sort_by and order parameters', async () => {
      const res = await fetch(`${ctx.BASE}/controlplane/stream-messages?namespace=durable&source=worker&sort_by=priority&order=asc`, {
        headers: authHeaders(ctx.builderToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('messages');
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
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({ appId: 'durable' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.subscribed).toBe(true);
    });
  });
});
