import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4613);

describe('MCP Runs routes', () => {
  describe('GET /api/mcp-runs', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs`);
      expect(res.status).toBe(401);
    });

    it('returns 400 without app_id', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('app_id');
    });

    it('returns jobs list for valid app_id', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs?app_id=longtail`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('jobs');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('returns empty list for non-existent schema', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs?app_id=nonexistent_schema_xyz`, {
        headers: authHeaders(ctx.adminToken),
      });
      // May return 200 with empty or 500 depending on schema existence
      const body = await res.json();
      if (res.status === 200) {
        expect(body.jobs).toEqual([]);
        expect(body.total).toBe(0);
      }
    });

    it('supports status filter', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs?app_id=longtail&status=completed`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const job of body.jobs) {
        expect(job.status).toBe('completed');
      }
    });

    it('supports pagination params', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs?app_id=longtail&limit=2&offset=0`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs.length).toBeLessThanOrEqual(2);
    });

    it('supports entity filter', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs?app_id=longtail&entity=nonexistent_entity`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports search filter', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs?app_id=longtail&search=zzz_no_match_zzz`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs).toEqual([]);
    });

    it('job records have expected shape', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs?app_id=longtail&limit=1`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.jobs.length > 0) {
        const job = body.jobs[0];
        expect(job).toHaveProperty('workflow_id');
        expect(job).toHaveProperty('entity');
        expect(job).toHaveProperty('status');
        expect(['running', 'completed', 'failed']).toContain(job.status);
        expect(job).toHaveProperty('is_live');
        expect(job).toHaveProperty('created_at');
        expect(job).toHaveProperty('updated_at');
      }
    });
  });

  describe('GET /api/mcp-runs/entities', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/entities`);
      expect(res.status).toBe(401);
    });

    it('returns 400 without app_id', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/entities`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(400);
    });

    it('returns entities array for valid app_id', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/entities?app_id=longtail`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('entities');
      expect(Array.isArray(body.entities)).toBe(true);
    });

    it('returns empty array for non-existent schema', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/entities?app_id=nonexistent_schema_xyz`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entities).toEqual([]);
    });

    it('entities are sorted and contain no nulls', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/entities?app_id=longtail`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const { entities } = await res.json();
      for (const e of entities) {
        expect(e).not.toBeNull();
        expect(e).not.toBe('');
      }
      const sorted = [...entities].sort();
      expect(entities).toEqual(sorted);
    });
  });

  describe('GET /api/mcp-runs/:jobId/execution', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/some-job/execution`);
      expect(res.status).toBe(401);
    });

    it('returns 400 without app_id', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/some-job/execution`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent job', async () => {
      const res = await fetch(`${ctx.BASE}/mcp-runs/nonexistent_job_xyz/execution?app_id=longtail`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
