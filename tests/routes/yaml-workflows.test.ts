import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4614);

describe('YAML Workflows routes', () => {
  describe('GET /api/yaml-workflows', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows`);
      expect(res.status).toBe(401);
    });

    it('returns workflow list', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('workflows');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.workflows)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports status filter', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows?status=active`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const wf of body.workflows) {
        expect(wf.status).toBe('active');
      }
    });

    it('supports graph_topic filter', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows?graph_topic=nonexistent_topic`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports app_id filter', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows?app_id=nonexistent_app`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports search filter', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows?search=zzz_no_match_zzz`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports pagination', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows?limit=1&offset=0`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/yaml-workflows/app-ids', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/app-ids`);
      expect(res.status).toBe(401);
    });

    it('returns an array of app_ids', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/app-ids`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('app_ids');
      expect(Array.isArray(body.app_ids)).toBe(true);
    });

    it('app_ids are strings and sorted', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/app-ids`, {
        headers: authHeaders(ctx.adminToken),
      });
      const body = await res.json();
      for (const id of body.app_ids) {
        expect(typeof id).toBe('string');
      }
      const sorted = [...body.app_ids].sort();
      expect(body.app_ids).toEqual(sorted);
    });
  });

  describe('GET /api/yaml-workflows/:id', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/yaml-workflows/:id', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ name: 'updated' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/yaml-workflows/:id', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/deploy', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id/deploy`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/invoke', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id/invoke`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ data: {} }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/regenerate', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id/regenerate`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/archive', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id/archive`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows (create)', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/yaml-workflows/:id/yaml', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${ctx.BASE}/yaml-workflows/nonexistent-id/yaml`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
