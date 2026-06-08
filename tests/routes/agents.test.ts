import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4641);

describe('Agent routes', () => {
  describe('Auth enforcement', () => {
    it('GET /api/agents returns 401 without token', async () => {
      const res = await fetch(`${ctx.BASE}/agents`);
      expect(res.status).toBe(401);
    });
  });

  describe('Agent CRUD lifecycle', () => {
    const agentId = `test-agent-${Date.now()}`;
    let createdId: string;

    it('POST /api/agents creates an agent', async () => {
      const res = await fetch(`${ctx.BASE}/agents`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          id: agentId,
          description: 'Test agent for integration tests',
          status: 'active',
          knowledge_domain: 'test',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.id).toBe(agentId);
      createdId = body.id;
    });

    it('POST /api/agents returns 400 without id', async () => {
      const res = await fetch(`${ctx.BASE}/agents`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/agents returns 409 for duplicate id', async () => {
      const res = await fetch(`${ctx.BASE}/agents`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          id: agentId,
          description: 'Duplicate',
          status: 'active',
          knowledge_domain: 'test',
        }),
      });
      expect(res.status).toBe(409);
    });

    it('GET /api/agents lists agents', async () => {
      const res = await fetch(`${ctx.BASE}/agents`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('total');
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/agents?status=active filters by status', async () => {
      const res = await fetch(`${ctx.BASE}/agents?status=active`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/agents/:id returns the agent with stats', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.id).toBe(createdId);
    });

    it('GET /api/agents/:id returns 404 for missing id', async () => {
      const res = await fetch(`${ctx.BASE}/agents/nonexistent-agent-id`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });

    it('PUT /api/agents/:id updates the agent', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ description: 'Updated description' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.description).toBe('Updated description');
    });

    // ── Subscriptions ──

    let subId: string;

    it('POST /api/agents/:agentId/subscriptions creates a subscription', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}/subscriptions`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          topic: 'app.test.>',
          reaction_type: 'durable',
          workflow_type: 'basicEcho',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body).toHaveProperty('id');
      subId = body.id;
    });

    it('POST /api/agents/:agentId/subscriptions returns 400 without topic', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}/subscriptions`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ reaction_type: 'durable' }),
      });
      expect(res.status).toBe(400);
    });

    it('GET /api/agents/:agentId/subscriptions lists subscriptions', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}/subscriptions`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('subscriptions');
      expect(body.subscriptions.length).toBeGreaterThanOrEqual(1);
    });

    it('DELETE /api/agents/:agentId/subscriptions/:subId deletes a subscription', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}/subscriptions/${subId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
    });

    // ── Cleanup ──

    it('DELETE /api/agents/:id deletes the agent', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
    });

    it('DELETE /api/agents/:id returns 404 after deletion', async () => {
      const res = await fetch(`${ctx.BASE}/agents/${createdId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
