import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';
import * as roleService from '../../services/role';

const ctx = setupRouteTest(4610);

describe('Roles routes', () => {
  describe('GET /api/roles', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/roles`);
      expect(res.status).toBe(401);
    });

    it('returns a roles array with valid auth', async () => {
      const res = await fetch(`${ctx.BASE}/roles`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body.roles)).toBe(true);
    });
  });

  describe('Escalation chains CRUD', () => {
    const chain = { source_role: 'test_role_a', target_role: 'test_role_b' };

    it('GET /api/roles/escalation-chains returns array', async () => {
      const res = await fetch(`${ctx.BASE}/roles/escalation-chains`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body.chains)).toBe(true);
    });

    it('POST /api/roles/escalation-chains requires admin', async () => {
      const res = await fetch(`${ctx.BASE}/roles/escalation-chains`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(403);
    });

    it('POST /api/roles/escalation-chains validates body', async () => {
      const res = await fetch(`${ctx.BASE}/roles/escalation-chains`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('source_role');
    });

    it('POST /api/roles/escalation-chains creates a chain', async () => {
      const res = await fetch(`${ctx.BASE}/roles/escalation-chains`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.source_role).toBe(chain.source_role);
      expect(body.target_role).toBe(chain.target_role);
    });

    it('DELETE /api/roles/escalation-chains requires admin', async () => {
      const res = await fetch(`${ctx.BASE}/roles/escalation-chains`, {
        method: 'DELETE',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(403);
    });

    it('DELETE /api/roles/escalation-chains removes the chain', async () => {
      const res = await fetch(`${ctx.BASE}/roles/escalation-chains`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.removed).toBe(true);
    });

    it('DELETE returns 404 for non-existent chain', async () => {
      const res = await fetch(`${ctx.BASE}/roles/escalation-chains`, {
        method: 'DELETE',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ source_role: 'nope', target_role: 'nada' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Escalation targets', () => {
    beforeAll(async () => {
      // Seed targets for testing
      await roleService.addEscalationChain('test_src', 'test_tgt_1');
      await roleService.addEscalationChain('test_src', 'test_tgt_2');
    });

    afterAll(async () => {
      await roleService.removeEscalationChain('test_src', 'test_tgt_1');
      await roleService.removeEscalationChain('test_src', 'test_tgt_2');
    });

    it('GET /api/roles/:role/escalation-targets returns targets', async () => {
      const res = await fetch(`${ctx.BASE}/roles/test_src/escalation-targets`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.targets).toContain('test_tgt_1');
      expect(body.targets).toContain('test_tgt_2');
    });

    it('GET returns empty array for unknown role', async () => {
      const res = await fetch(`${ctx.BASE}/roles/nonexistent_role/escalation-targets`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.targets).toEqual([]);
    });

    it('PUT /api/roles/:role/escalation-targets requires admin', async () => {
      const res = await fetch(`${ctx.BASE}/roles/test_src/escalation-targets`, {
        method: 'PUT',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ targets: ['a'] }),
      });
      expect(res.status).toBe(403);
    });

    it('PUT /api/roles/:role/escalation-targets validates body', async () => {
      const res = await fetch(`${ctx.BASE}/roles/test_src/escalation-targets`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ targets: 'not-an-array' }),
      });
      expect(res.status).toBe(400);
    });

    it('PUT replaces targets for a role', async () => {
      const res = await fetch(`${ctx.BASE}/roles/test_src/escalation-targets`, {
        method: 'PUT',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ targets: ['replaced_tgt'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.targets).toEqual(['replaced_tgt']);

      // Verify via GET
      const verify = await fetch(`${ctx.BASE}/roles/test_src/escalation-targets`, {
        headers: authHeaders(ctx.memberToken),
      });
      const verifyBody = await verify.json() as any;
      expect(verifyBody.targets).toEqual(['replaced_tgt']);

      // Restore original targets for cleanup
      await roleService.replaceEscalationTargets('test_src', ['test_tgt_1', 'test_tgt_2']);
    });
  });
});
