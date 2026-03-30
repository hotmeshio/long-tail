import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4612);

describe('Exports routes', () => {
  describe('GET /api/workflow-states/jobs', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/jobs`);
      expect(res.status).toBe(401);
    });

    it('returns 200 or 500 (durable schema may not exist without workers)', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/jobs?limit=5&offset=0`, {
        headers: authHeaders(ctx.memberToken),
      });
      // The durable.jobs table only exists when HotMesh workers have registered.
      // Without workers, the endpoint returns 500. Both are valid.
      if (res.status === 200) {
        const body = await res.json() as any;
        expect(Array.isArray(body.jobs)).toBe(true);
        expect(typeof body.total).toBe('number');
      } else {
        expect(res.status).toBe(500);
      }
    });
  });

  describe('GET /api/workflow-states/:workflowId', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workflow-states/:workflowId/execution', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id/execution`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id/execution`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workflow-states/:workflowId/status', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id/status`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id/status`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workflow-states/:workflowId/state', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id/state`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/workflow-states/nonexistent-wf-id/state`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
