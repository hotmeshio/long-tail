import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4617);

describe('Escalation routes', () => {
  describe('GET /api/escalations', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations`);
      expect(res.status).toBe(401);
    });

    it('returns escalations array with valid auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('escalations');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.escalations)).toBe(true);
      expect(typeof body.total).toBe('number');
    });
  });

  describe('GET /api/escalations/types', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/types`);
      expect(res.status).toBe(401);
    });

    it('returns types array', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/types`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('types');
      expect(Array.isArray(body.types)).toBe(true);
    });
  });

  describe('GET /api/escalations/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/stats`);
      expect(res.status).toBe(401);
    });

    it('returns stats object', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/stats`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body.pending).toBe('number');
      expect(typeof body.claimed).toBe('number');
      expect(typeof body.created).toBe('number');
      expect(typeof body.resolved).toBe('number');
      expect(Array.isArray(body.by_role)).toBe(true);
      expect(Array.isArray(body.by_type)).toBe(true);
    });
  });

  describe('GET /api/escalations/:id', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/nonexistent-id`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent escalation', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/escalations/by-workflow/:workflowId', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/by-workflow/some-wf-id`);
      expect(res.status).toBe(401);
    });

    it('returns empty array for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/by-workflow/nonexistent-wf-id`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('escalations');
      expect(Array.isArray(body.escalations)).toBe(true);
      expect(body.escalations).toEqual([]);
    });
  });

  describe('POST /api/escalations/:id/claim', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/some-id/claim`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent escalation', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099/claim`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/escalations/available', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/available`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/escalations/release-expired', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/release-expired`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/escalations/:id/release', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099/release`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/escalations/bulk-claim', () => {
    it('returns 400 with empty ids', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/bulk-claim`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ ids: [] }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/escalations/:id/resolve', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/some-id/resolve`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 when resolverPayload is missing', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/some-id/resolve`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('resolverPayload');
    });

    it('returns 404 for non-existent escalation', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099/resolve`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ resolverPayload: { answer: 'test' } }),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });
});
