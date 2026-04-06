import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4631);

describe('Bot account routes', () => {
  describe('Auth enforcement', () => {
    it('GET /api/bot-accounts returns 401 without token', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts`);
      expect(res.status).toBe(401);
    });

    it('GET /api/bot-accounts returns 403 for member role', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Bot CRUD lifecycle', () => {
    const botName = `test-bot-${Date.now()}`;
    let botId: string;

    it('POST /api/bot-accounts creates a bot', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          name: botName,
          description: 'Test bot for integration tests',
          display_name: 'Test Bot',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.external_id).toBe(botName);
      expect(body.account_type).toBe('bot');
      expect(body.description).toBe('Test bot for integration tests');
      expect(body).toHaveProperty('id');
      botId = body.id;
    });

    it('POST /api/bot-accounts returns 400 without name', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/bot-accounts returns 409 for duplicate name', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ name: botName }),
      });
      expect(res.status).toBe(409);
    });

    it('GET /api/bot-accounts lists bots', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('bots');
      expect(body).toHaveProperty('total');
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.bots.some((b: any) => b.id === botId)).toBe(true);
    });

    it('GET /api/bot-accounts/:id returns single bot', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.id).toBe(botId);
      expect(body.account_type).toBe('bot');
    });

    it('GET /api/bot-accounts/:id returns 404 for non-existent', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });

    it('PUT /api/bot-accounts/:id updates bot', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ display_name: 'Updated Bot', description: 'Updated desc' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.display_name).toBe('Updated Bot');
      expect(body.description).toBe('Updated desc');
    });

    // ── Roles ──

    it('POST /api/bot-accounts/:id/roles adds role', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}/roles`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ role: 'scheduler', type: 'member' }),
      });
      expect(res.status).toBe(201);
    });

    it('GET /api/bot-accounts/:id/roles lists roles', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}/roles`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.roles.some((r: any) => r.role === 'scheduler')).toBe(true);
    });

    it('DELETE /api/bot-accounts/:id/roles/:role removes role', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}/roles/scheduler`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      expect((await res.json() as any).removed).toBe(true);
    });

    // ── API keys ──

    let keyId: string;
    let rawKey: string;

    it('POST /api/bot-accounts/:id/api-keys generates key', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}/api-keys`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ name: 'test-key', scopes: ['mcp:tool:call'] }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('rawKey');
      expect(body.rawKey).toMatch(/^lt_bot_/);
      keyId = body.id;
      rawKey = body.rawKey;
    });

    it('GET /api/bot-accounts/:id/api-keys lists keys (without secrets)', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}/api-keys`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.keys.length).toBeGreaterThanOrEqual(1);
      // Ensure no secrets leaked
      expect(body.keys[0]).not.toHaveProperty('key_hash');
      expect(body.keys[0]).not.toHaveProperty('rawKey');
    });

    it('bot API key authenticates to protected endpoints', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`, {
        headers: authHeaders(rawKey),
      });
      // Should authenticate (200) not 401
      expect(res.status).toBe(200);
    });

    it('DELETE /api/bot-accounts/:id/api-keys/:keyId revokes key', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      expect((await res.json() as any).revoked).toBe(true);
    });

    it('revoked key no longer authenticates', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`, {
        headers: authHeaders(rawKey),
      });
      expect(res.status).toBe(401);
    });

    // ── Cleanup ──

    it('DELETE /api/bot-accounts/:id deletes bot', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      expect((await res.json() as any).deleted).toBe(true);
    });

    it('deleted bot returns 404', async () => {
      const res = await fetch(`${ctx.BASE}/bot-accounts/${botId}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
