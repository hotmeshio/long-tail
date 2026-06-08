import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4617);

describe('Escalation routes', () => {
  describe('POST /api/escalations (create)', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'support', role: 'reviewer' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 when type is missing', async () => {
      const res = await fetch(`${ctx.BASE}/escalations`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ role: 'reviewer' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('type');
    });

    it('returns 400 when role is missing', async () => {
      const res = await fetch(`${ctx.BASE}/escalations`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ type: 'support' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('role');
    });
  });

  describe('GET /api/escalations', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations`);
      expect(res.status).toBe(401);
    });

    it('returns escalations array with valid auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('escalations');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.escalations)).toBe(true);
      expect(typeof body.total).toBe('number');
    });
  });

  describe('GET /api/escalations/types', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/types`);
      expect(res.status).toBe(401);
    });

    it('returns types array', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/types`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('types');
      expect(Array.isArray(body.types)).toBe(true);
    });
  });

  describe('GET /api/escalations/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/stats`);
      expect(res.status).toBe(401);
    });

    it('returns stats object', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/stats`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body.pending).toBe('number');
      expect(typeof body.claimed).toBe('number');
      expect(typeof body.created).toBe('number');
      expect(typeof body.resolved).toBe('number');
      expect(Array.isArray(body.by_role)).toBe(true);
      expect(Array.isArray(body.by_type)).toBe(true);
    });
  });

  describe('GET /api/escalations/:id', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/nonexistent-id`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent escalation', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/escalations/by-workflow/:workflowId', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/by-workflow/some-wf-id`);
      expect(res.status).toBe(401);
    });

    it('returns empty array for unknown workflow', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/by-workflow/nonexistent-wf-id`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('escalations');
      expect(Array.isArray(body.escalations)).toBe(true);
      expect(body.escalations).toEqual([]);
    });
  });

  describe('POST /api/escalations/:id/claim', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/some-id/claim`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent escalation', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099/claim`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/escalations/available', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/available`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/escalations/release-expired', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/release-expired`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/escalations/:id/release', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099/release`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/escalations/bulk-claim', () => {
    it('returns 400 with empty ids', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/bulk-claim`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ ids: [] }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/escalations/:id/resolve', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/some-id/resolve`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 when resolverPayload is missing', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/some-id/resolve`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('resolverPayload');
    });

    it('returns 404 for non-existent escalation', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/00000000-0000-0000-0000-000000000099/resolve`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ resolverPayload: { answer: 'test' } }),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  // ── Metadata-based operations ──────────────────────────────────────────

  describe('GET /api/escalations/by-metadata', () => {
    it('returns 400 when key is missing', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/by-metadata?value=test`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(400);
    });

    it('returns empty array for non-matching metadata', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/by-metadata?key=nonexistent&value=none`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.escalations).toEqual([]);
    });
  });

  describe('POST /api/escalations/claim-by-metadata', () => {
    it('returns 400 when key/value missing', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/claim-by-metadata`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when no escalation matches', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/claim-by-metadata`, {
        method: 'POST',
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({ key: 'orderId', value: 'nonexistent-order' }),
      });
      expect(res.status).toBe(404);
    });

    it('builder (superadmin) can claim by metadata', async () => {
      // Create escalation with metadata
      const createRes = await fetch(`${ctx.BASE}/escalations`, {
        method: 'POST',
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({
          type: 'meta-claim-test',
          role: 'reviewer',
          description: 'Metadata claim test',
          metadata: { orderId: `claim-test-${Date.now()}` },
        }),
      });
      expect(createRes.status).toBe(201);
      const { metadata } = await createRes.json() as any;

      const res = await fetch(`${ctx.BASE}/escalations/claim-by-metadata`, {
        method: 'POST',
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({ key: 'orderId', value: metadata.orderId }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.escalation).toBeDefined();
      expect(body.escalation.status).toBe('pending');
    });

    it('member token gets 404 for role-scoped metadata claim', async () => {
      // Create escalation on a role the member doesn't have
      const createRes = await fetch(`${ctx.BASE}/escalations`, {
        method: 'POST',
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({
          type: 'meta-rbac-test',
          role: 'engineer',
          description: 'RBAC test',
          metadata: { orderId: `rbac-test-${Date.now()}` },
        }),
      });
      expect(createRes.status).toBe(201);
      const { metadata } = await createRes.json() as any;

      // Member has no roles → SQL WHERE filters out, returns 404
      const res = await fetch(`${ctx.BASE}/escalations/claim-by-metadata`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ key: 'orderId', value: metadata.orderId }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/escalations/resolve-by-metadata', () => {
    it('returns 400 when key/value missing', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/resolve-by-metadata`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('builder can atomically resolve by metadata', async () => {
      const orderId = `resolve-test-${Date.now()}`;
      const createRes = await fetch(`${ctx.BASE}/escalations`, {
        method: 'POST',
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({
          type: 'meta-resolve-test',
          role: 'reviewer',
          description: 'Metadata resolve test',
          metadata: { orderId },
        }),
      });
      expect(createRes.status).toBe(201);

      const res = await fetch(`${ctx.BASE}/escalations/resolve-by-metadata`, {
        method: 'POST',
        headers: authHeaders(ctx.builderToken),
        body: JSON.stringify({
          key: 'orderId',
          value: orderId,
          resolverPayload: { answer: 'approved' },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.escalation).toBeDefined();
      expect(body.escalation.status).toBe('resolved');
    });
  });

  // ── Bulk operations ────────────────────────────────────────────────────

  describe('POST /api/escalations/bulk-assign', () => {
    it('returns 400 with empty ids', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/bulk-assign`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ ids: [], targetUserId: 'someone' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/escalations/bulk-escalate', () => {
    it('returns 400 with empty ids', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/bulk-escalate`, {
        method: 'PATCH',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ ids: [], targetRole: 'admin' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/escalations/priority', () => {
    it('returns 400 with empty ids', async () => {
      const res = await fetch(`${ctx.BASE}/escalations/priority`, {
        method: 'PATCH',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ ids: [], priority: 1 }),
      });
      expect(res.status).toBe(400);
    });
  });
});
