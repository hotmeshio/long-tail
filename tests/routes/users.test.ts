import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4619);

describe('User routes', () => {
  describe('GET /api/users', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/users`);
      expect(res.status).toBe(401);
    });

    it('returns users array with valid auth', async () => {
      const res = await fetch(`${ctx.BASE}/users`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('users');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.users)).toBe(true);
      expect(typeof body.total).toBe('number');
    });
  });

  describe('POST /api/users (admin-only)', () => {
    it('returns 403 for member role', async () => {
      const res = await fetch(`${ctx.BASE}/users`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ external_id: 'test-user' }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 when external_id is missing', async () => {
      const res = await fetch(`${ctx.BASE}/users`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('external_id');
    });

    it('returns 400 for invalid role type in roles array', async () => {
      const res = await fetch(`${ctx.BASE}/users`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          external_id: 'bad-role-user',
          roles: [{ role: 'reviewer', type: 'invalid_type' }],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('role');
    });
  });

  describe('User CRUD lifecycle', () => {
    const extId = `route-test-user-${Date.now()}`;
    let createdUserId: string;

    it('POST creates a user', async () => {
      const res = await fetch(`${ctx.BASE}/users`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          external_id: extId,
          email: 'test@example.com',
          display_name: 'Route Test User',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.external_id).toBe(extId);
      expect(body).toHaveProperty('id');
      createdUserId = body.id;
    });

    it('GET retrieves the created user', async () => {
      const res = await fetch(`${ctx.BASE}/users/${createdUserId}`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.id).toBe(createdUserId);
      expect(body.external_id).toBe(extId);
    });

    it('PUT updates the user (admin required)', async () => {
      const memberRes = await fetch(`${ctx.BASE}/users/${createdUserId}`, {
        method: 'PUT',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ display_name: 'Updated Name' }),
      });
      expect(memberRes.status).toBe(403);

      const res = await fetch(`${ctx.BASE}/users/${createdUserId}`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ display_name: 'Updated Name' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.display_name).toBe('Updated Name');
    });

    it('DELETE removes the user (admin required)', async () => {
      const memberRes = await fetch(`${ctx.BASE}/users/${createdUserId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.memberToken),
      });
      expect(memberRes.status).toBe(403);

      const res = await fetch(`${ctx.BASE}/users/${createdUserId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.deleted).toBe(true);
    });

    it('GET returns 404 for deleted user', async () => {
      const res = await fetch(`${ctx.BASE}/users/${createdUserId}`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Role management', () => {
    const extId = `role-test-user-${Date.now()}`;
    let userId: string;

    beforeAll(async () => {
      const res = await fetch(`${ctx.BASE}/users`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ external_id: extId }),
      });
      const body = await res.json() as any;
      userId = body.id;
    });

    afterAll(async () => {
      await fetch(`${ctx.BASE}/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
    });

    it('GET /api/users/:id/roles returns roles array', async () => {
      const res = await fetch(`${ctx.BASE}/users/${userId}/roles`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('roles');
      expect(Array.isArray(body.roles)).toBe(true);
    });

    it('POST /api/users/:id/roles adds a role (admin required)', async () => {
      const memberRes = await fetch(`${ctx.BASE}/users/${userId}/roles`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ role: 'reviewer', type: 'member' }),
      });
      expect(memberRes.status).toBe(403);

      const res = await fetch(`${ctx.BASE}/users/${userId}/roles`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ role: 'reviewer', type: 'member' }),
      });
      expect(res.status).toBe(201);
    });

    it('POST /api/users/:id/roles validates required fields', async () => {
      const res = await fetch(`${ctx.BASE}/users/${userId}/roles`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('role');
    });

    it('DELETE /api/users/:id/roles/:role removes the role', async () => {
      const res = await fetch(`${ctx.BASE}/users/${userId}/roles/reviewer`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.removed).toBe(true);
    });

    it('DELETE returns 404 for non-existent role', async () => {
      const res = await fetch(`${ctx.BASE}/users/${userId}/roles/nonexistent-role`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/users/:id (404)', () => {
    it('returns 404 for non-existent user', async () => {
      const res = await fetch(`${ctx.BASE}/users/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });
});
