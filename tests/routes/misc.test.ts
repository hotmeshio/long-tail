import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4622);

describe('Settings routes', () => {
  describe('GET /api/settings', () => {
    it('returns 200 without auth (public endpoint for transport detection)', async () => {
      const res = await fetch(`${ctx.BASE}/settings`);
      expect(res.status).toBe(200);
    });

    it('returns telemetry and escalation config', async () => {
      const res = await fetch(`${ctx.BASE}/settings`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('telemetry');
      expect(body).toHaveProperty('escalation');
      expect(body.escalation).toHaveProperty('claimDurations');
      expect(Array.isArray(body.escalation.claimDurations)).toBe(true);
    });
  });
});

describe('Namespace routes', () => {
  describe('GET /api/namespaces', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/namespaces`);
      expect(res.status).toBe(401);
    });

    it('returns namespaces array', async () => {
      const res = await fetch(`${ctx.BASE}/namespaces`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('namespaces');
      expect(Array.isArray(body.namespaces)).toBe(true);
    });
  });

  describe('POST /api/namespaces', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/namespaces`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('allows member role to create namespace', async () => {
      const name = `test-ns-member-${Date.now()}`;
      const res = await fetch(`${ctx.BASE}/namespaces`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ name, description: 'Member namespace' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.name).toBe(name);
    });

    it('returns 400 when name is missing', async () => {
      const res = await fetch(`${ctx.BASE}/namespaces`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('name');
    });

    it('creates a namespace with valid name', async () => {
      const name = `test-ns-${Date.now()}`;
      const res = await fetch(`${ctx.BASE}/namespaces`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ name, description: 'Test namespace' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.name).toBe(name);
    });
  });
});

describe('DBA routes', () => {
  describe('POST /api/dba/prune', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/dba/prune`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns counts shape', async () => {
      const res = await fetch(`${ctx.BASE}/dba/prune`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ expire: '7 days' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body).toBe('object');
      expect(typeof body.jobs).toBe('number');
      expect(typeof body.streams).toBe('number');
    });
  });
});

describe('Insight routes', () => {
  describe('POST /api/insight/mcp-query', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/insight/mcp-query`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await fetch(`${ctx.BASE}/insight/mcp-query`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('prompt');
    });

    it('accepts async mode and returns workflow_id or 503', async () => {
      const res = await fetch(`${ctx.BASE}/insight/mcp-query`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ prompt: 'test query', wait: false }),
      });
      // 503 if no LLM key, 200 if key present (async mode returns immediately)
      expect([200, 503]).toContain(res.status);
      const body = await res.json() as any;
      if (res.status === 200) {
        expect(body.workflow_id).toBeDefined();
        expect(body.status).toBe('started');
      }
    });
  });

  describe('POST /api/insight/mcp-query/describe', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/insight/mcp-query/describe`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await fetch(`${ctx.BASE}/insight/mcp-query/describe`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('prompt');
    });

    it('returns fallback description when no LLM key', async () => {
      const res = await fetch(`${ctx.BASE}/insight/mcp-query/describe`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ prompt: 'Count active users by role' }),
      });
      // Without LLM key, the endpoint falls back gracefully
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('description');
      expect(body).toHaveProperty('tags');
      expect(Array.isArray(body.tags)).toBe(true);
    });
  });

  describe('POST /api/insight/build-workflow', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('prompt');
    });

    it('accepts async mode and returns workflow_id or 503', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ prompt: 'screenshot a webpage and save it', wait: false }),
      });
      expect([200, 503]).toContain(res.status);
      const body = await res.json() as any;
      if (res.status === 200) {
        expect(body.workflow_id).toBeDefined();
        expect(body.status).toBe('started');
      }
    });

    it('accepts tags parameter', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ prompt: 'test', tags: ['browser-automation'], wait: false }),
      });
      expect([200, 503]).toContain(res.status);
    });
  });

  describe('POST /api/insight/build-workflow/refine', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow/refine`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow/refine`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ prompt: 'test' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('prior_yaml');
    });

    it('returns 400 when feedback is missing', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow/refine`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ prompt: 'test', prior_yaml: 'app:\n  id: test' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('feedback');
    });

    it('accepts valid refine request or 503', async () => {
      const res = await fetch(`${ctx.BASE}/insight/build-workflow/refine`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({
          prompt: 'screenshot a webpage',
          prior_yaml: 'app:\n  id: test\n  version: "1"',
          feedback: 'screenshot_path missing .png extension',
          wait: false,
        }),
      });
      expect([200, 503]).toContain(res.status);
    });
  });
});
