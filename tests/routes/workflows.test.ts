import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4618);

describe('Workflow routes', () => {
  describe('GET /api/workflows/cron/status', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/cron/status`);
      expect(res.status).toBe(401);
    });

    it('returns schedules array', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/cron/status`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('schedules');
      expect(Array.isArray(body.schedules)).toBe(true);
    });
  });

  describe('GET /api/workflows/config', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/config`);
      expect(res.status).toBe(401);
    });

    it('returns workflows config array', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/config`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('workflows');
      expect(Array.isArray(body.workflows)).toBe(true);
    });
  });

  describe('GET /api/workflows/:type/config', () => {
    it('returns 404 for unknown workflow type', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/nonexistent-type/config`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('Config CRUD (PUT → GET → DELETE)', () => {
    const testType = 'route-test-workflow';

    it('PUT creates a workflow config (admin required)', async () => {
      // Member should get 403
      const memberRes = await fetch(`${ctx.BASE}/workflows/${testType}/config`, {
        method: 'PUT',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ task_queue: 'test-queue', description: 'Test' }),
      });
      expect(memberRes.status).toBe(403);

      // Admin succeeds
      const res = await fetch(`${ctx.BASE}/workflows/${testType}/config`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ task_queue: 'test-queue', description: 'Test workflow' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.workflow_type).toBe(testType);
      expect(body.description).toBe('Test workflow');
    });

    it('GET reads the created config', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/${testType}/config`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.workflow_type).toBe(testType);
    });

    it('DELETE removes the config (admin required)', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/${testType}/config`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.deleted).toBe(true);
    });

    it('DELETE returns 404 for already-deleted config', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/${testType}/config`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/workflows/:type/invoke', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/some-type/invoke`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 404 when type has no config', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/unconfigured-type/invoke`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 for unknown workflow type', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/nonexistent-type/invoke`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ data: { test: true } }),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/workflows/:workflowId/result', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/nonexistent-wf-id/result`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/nonexistent-wf-id/result`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/workflows/:workflowId/terminate', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/nonexistent-wf-id/terminate`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/workflows/nonexistent-wf-id/terminate`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });
  });
});
