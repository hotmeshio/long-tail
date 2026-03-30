import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4615);

describe('MCP Servers routes', () => {
  describe('GET /api/mcp/servers', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers`);
      expect(res.status).toBe(401);
    });

    it('returns server list', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('servers');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.servers)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports status filter', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers?status=connected`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const srv of body.servers) {
        expect(srv.status).toBe('connected');
      }
    });

    it('supports search filter', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers?search=zzz_no_match_zzz`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports pagination', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers?limit=1&offset=0`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/mcp/servers/:id', () => {
    it('returns 404 for non-existent server', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/mcp/servers', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/mcp/servers/:id', () => {
    it('returns 404 for non-existent server', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers/00000000-0000-0000-0000-000000000099`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ description: 'updated' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/mcp/servers/:id', () => {
    it('returns 404 for non-existent server', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers/00000000-0000-0000-0000-000000000099`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
