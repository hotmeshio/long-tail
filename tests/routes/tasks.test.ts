import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4621);

describe('Task routes', () => {
  describe('GET /api/tasks', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`);
      expect(res.status).toBe(401);
    });

    it('returns tasks array with total', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('tasks');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports pagination params', async () => {
      const res = await fetch(`${ctx.BASE}/tasks?limit=2&offset=0`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tasks.length).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/nonexistent-id`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown task ID', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/tasks/processes/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/stats`);
      expect(res.status).toBe(401);
    });

    it('returns stats counts', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/stats`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body).toBe('object');
      // Stats should contain numeric count fields
      expect(typeof body.total).toBe('number');
    });
  });

  describe('GET /api/tasks/processes', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes`);
      expect(res.status).toBe(401);
    });

    it('returns processes array', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('processes');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.processes)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports pagination', async () => {
      const res = await fetch(`${ctx.BASE}/tasks?limit=1&offset=0`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tasks.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/tasks/processes/:originId', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/nonexistent-origin`);
      expect(res.status).toBe(401);
    });

    it('returns tasks and escalations for unknown origin (empty)', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/nonexistent-origin-id`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('origin_id', 'nonexistent-origin-id');
      expect(body).toHaveProperty('tasks');
      expect(body).toHaveProperty('escalations');
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(Array.isArray(body.escalations)).toBe(true);
    });
  });
});
