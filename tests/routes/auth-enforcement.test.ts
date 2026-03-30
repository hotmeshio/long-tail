import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';
import { signToken } from '../../modules/auth';

const ctx = setupRouteTest(4616);

describe('Auth enforcement', () => {
  const protectedRoutes = [
    { method: 'GET', path: '/roles' },
    { method: 'GET', path: '/roles/escalation-chains' },
    { method: 'GET', path: '/config/maintenance' },
    { method: 'GET', path: '/workflow-states/jobs' },
    { method: 'GET', path: '/escalations' },
    { method: 'GET', path: '/tasks' },
    { method: 'GET', path: '/users' },
    { method: 'GET', path: '/workflows/config' },
    { method: 'GET', path: '/workflows/cron/status' },
    { method: 'GET', path: '/yaml-workflows' },
    { method: 'GET', path: '/mcp/servers' },
    { method: 'GET', path: '/controlplane/apps' },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.path} returns 401 without token`, async () => {
      const res = await fetch(`${ctx.BASE}${route.path}`, { method: route.method });
      expect(res.status).toBe(401);
    });
  }

  it('returns 401 for expired tokens', async () => {
    // Sign with 0s expiry (immediately expired)
    const expired = signToken({ userId: 'user-1' }, '0s');
    const res = await fetch(`${ctx.BASE}/roles`, {
      headers: authHeaders(expired),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for malformed tokens', async () => {
    const res = await fetch(`${ctx.BASE}/roles`, {
      headers: { Authorization: 'Bearer garbage-token' },
    });
    expect(res.status).toBe(401);
  });
});
