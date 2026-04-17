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

  describe('POST /api/mcp/servers with extended fields', () => {
    it('creates a server with tags, compile_hints, and credential_providers', async () => {
      const name = `test-extended-${Date.now()}`;
      const res = await fetch(`${ctx.BASE}/mcp/servers`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          name,
          transport_type: 'stdio',
          transport_config: { command: 'echo', args: ['hello'] },
          tags: ['database', 'analytics'],
          compile_hints: 'Use this server for DB queries only',
          credential_providers: ['github', 'slack'],
        }),
      });
      expect(res.status).toBe(201);
      const server = await res.json();
      expect(server.name).toBe(name);
      expect(server.tags).toEqual(['database', 'analytics']);
      expect(server.compile_hints).toBe('Use this server for DB queries only');
      expect(server.credential_providers).toEqual(['github', 'slack']);

      // cleanup
      await fetch(`${ctx.BASE}/mcp/servers/${server.id}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
    });
  });

  describe('PUT /api/mcp/servers/:id with extended fields', () => {
    it('updates tags, compile_hints, and credential_providers', async () => {
      const name = `test-update-ext-${Date.now()}`;
      const createRes = await fetch(`${ctx.BASE}/mcp/servers`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          name,
          transport_type: 'stdio',
          transport_config: { command: 'echo', args: ['hi'] },
          tags: ['old-tag'],
          compile_hints: 'original hint',
          credential_providers: ['github'],
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();

      const updateRes = await fetch(`${ctx.BASE}/mcp/servers/${created.id}`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          tags: ['new-tag-a', 'new-tag-b'],
          compile_hints: 'updated hint',
          credential_providers: ['slack', 'jira'],
        }),
      });
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.tags).toEqual(['new-tag-a', 'new-tag-b']);
      expect(updated.compile_hints).toBe('updated hint');
      expect(updated.credential_providers).toEqual(['slack', 'jira']);

      // cleanup
      await fetch(`${ctx.BASE}/mcp/servers/${created.id}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
    });
  });

  describe('POST /api/mcp/servers/test-connection', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers/test-connection`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 without required fields', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers/test-connection`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ transport_type: 'stdio' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/transport_type and transport_config/);
    });

    it('returns response with success field for invalid connection', async () => {
      const res = await fetch(`${ctx.BASE}/mcp/servers/test-connection`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          transport_type: 'stdio',
          transport_config: { command: 'nonexistent-binary-xyz', args: [] },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('success');
      expect(body.success).toBe(false);
      expect(body).toHaveProperty('tools');
      expect(Array.isArray(body.tools)).toBe(true);
    });
  });

  describe('Full CRUD lifecycle with extended fields', () => {
    it('create -> read -> update -> verify -> delete -> verify 404', async () => {
      const name = `test-lifecycle-${Date.now()}`;

      // 1. Create with all fields
      const createRes = await fetch(`${ctx.BASE}/mcp/servers`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          name,
          description: 'lifecycle test server',
          transport_type: 'stdio',
          transport_config: { command: 'echo', args: ['lifecycle'] },
          tags: ['test', 'lifecycle'],
          compile_hints: 'lifecycle hint',
          credential_providers: ['github'],
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      expect(created.id).toBeDefined();
      expect(created.name).toBe(name);
      expect(created.tags).toEqual(['test', 'lifecycle']);
      expect(created.compile_hints).toBe('lifecycle hint');
      expect(created.credential_providers).toEqual(['github']);

      // 2. Read back
      const getRes = await fetch(`${ctx.BASE}/mcp/servers/${created.id}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(getRes.status).toBe(200);
      const fetched = await getRes.json();
      expect(fetched.name).toBe(name);
      expect(fetched.description).toBe('lifecycle test server');
      expect(fetched.tags).toEqual(['test', 'lifecycle']);
      expect(fetched.compile_hints).toBe('lifecycle hint');
      expect(fetched.credential_providers).toEqual(['github']);

      // 3. Update extended fields
      const updateRes = await fetch(`${ctx.BASE}/mcp/servers/${created.id}`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          description: 'updated description',
          tags: ['updated'],
          compile_hints: 'updated hint',
          credential_providers: ['slack', 'jira'],
        }),
      });
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.description).toBe('updated description');
      expect(updated.tags).toEqual(['updated']);
      expect(updated.compile_hints).toBe('updated hint');
      expect(updated.credential_providers).toEqual(['slack', 'jira']);

      // 4. Verify update persisted
      const verifyRes = await fetch(`${ctx.BASE}/mcp/servers/${created.id}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(verifyRes.status).toBe(200);
      const verified = await verifyRes.json();
      expect(verified.tags).toEqual(['updated']);
      expect(verified.compile_hints).toBe('updated hint');
      expect(verified.credential_providers).toEqual(['slack', 'jira']);

      // 5. Delete
      const deleteRes = await fetch(`${ctx.BASE}/mcp/servers/${created.id}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(deleteRes.status).toBe(200);
      const deleteBody = await deleteRes.json();
      expect(deleteBody.deleted).toBe(true);

      // 6. Verify 404 after delete
      const gone = await fetch(`${ctx.BASE}/mcp/servers/${created.id}`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(gone.status).toBe(404);
    });
  });
});
