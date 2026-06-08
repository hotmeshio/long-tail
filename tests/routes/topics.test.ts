import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4642);

describe('Topic routes', () => {
  describe('Auth enforcement', () => {
    it('GET /api/topics returns 401 without token', async () => {
      const res = await fetch(`${ctx.BASE}/topics`);
      expect(res.status).toBe(401);
    });
  });

  describe('Topic CRUD lifecycle', () => {
    const topicName = 'app.test.created';

    it('POST /api/topics creates a topic', async () => {
      const res = await fetch(`${ctx.BASE}/topics`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          topic: topicName,
          category: 'app',
          description: 'Test topic',
          tags: ['test'],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.topic).toBe(topicName);
      expect(body.category).toBe('app');
    });

    it('POST /api/topics returns 400 without topic or category', async () => {
      const res = await fetch(`${ctx.BASE}/topics`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('GET /api/topics lists topics', async () => {
      const res = await fetch(`${ctx.BASE}/topics`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.total).toBeGreaterThan(0);
    });

    it('GET /api/topics?category=app filters by category', async () => {
      const res = await fetch(`${ctx.BASE}/topics?category=app`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.topics.every((t: any) => t.category === 'app')).toBe(true);
    });

    it('GET /api/topics?search=test searches', async () => {
      const res = await fetch(`${ctx.BASE}/topics?search=test`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.topics.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/topics/by-name/:topic returns the topic', async () => {
      const res = await fetch(`${ctx.BASE}/topics/by-name/${encodeURIComponent(topicName)}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.topic).toBe(topicName);
    });

    it('GET /api/topics/by-name/:topic returns 404 for missing topic', async () => {
      const res = await fetch(`${ctx.BASE}/topics/by-name/${encodeURIComponent('no.such.topic')}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });

    it('PUT /api/topics/by-name/:topic updates description/tags', async () => {
      const res = await fetch(`${ctx.BASE}/topics/by-name/${encodeURIComponent(topicName)}`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ description: 'Updated description', tags: ['test', 'updated'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.description).toBe('Updated description');
    });

    it('DELETE /api/topics/by-name/:topic deletes the topic', async () => {
      const res = await fetch(`${ctx.BASE}/topics/by-name/${encodeURIComponent(topicName)}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.deleted).toBe(true);
    });

    it('DELETE a system topic should fail', async () => {
      const systemTopic = 'system.task.*.created';
      const res = await fetch(`${ctx.BASE}/topics/by-name/${encodeURIComponent(systemTopic)}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect([400, 403]).toContain(res.status);
    });
  });
});
