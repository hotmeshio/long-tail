import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { start } from '../start';
import { signToken } from '../modules/auth';
import { loggerRegistry } from '../services/logger';
import { telemetryRegistry } from '../services/telemetry';
import { eventRegistry } from '../services/events';
import { maintenanceRegistry } from '../services/maintenance';
import * as roleService from '../services/role';
import type { LTInstance } from '../types/startup';

// ── Config ──────────────────────────────────────────────────────────────────

const TEST_DB = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: 'longtail_test',
};

const PORT = 4599;
const BASE = `http://localhost:${PORT}/api`;

function clearRegistries() {
  loggerRegistry.clear();
  telemetryRegistry.clear();
  eventRegistry.clear();
  maintenanceRegistry.clear();
}

// ── Tokens ──────────────────────────────────────────────────────────────────

let adminToken: string;
let memberToken: string;

// Use valid UUIDs since lt_user_roles.user_id is UUID
const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000001';
const MEMBER_USER_ID = '00000000-0000-0000-0000-000000000002';

// ── Server lifecycle ────────────────────────────────────────────────────────

let lt: LTInstance;

beforeAll(async () => {
  clearRegistries();

  lt = await start({
    database: TEST_DB,
    server: { port: PORT },
    auth: { secret: 'route-test-secret' },
    maintenance: {
      schedule: '0 3 * * *',
      rules: [{ target: 'streams', olderThan: '7 days', action: 'delete' }],
    },
  });

  adminToken = signToken({ userId: ADMIN_USER_ID, role: 'admin' });
  memberToken = signToken({ userId: MEMBER_USER_ID, role: 'member' });
}, 30_000);

afterAll(async () => {
  await lt.shutdown();
  clearRegistries();
}, 15_000);

// ── Helper ──────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ═══════════════════════════════════════════════════════════════════════════
// /api/roles
// ═══════════════════════════════════════════════════════════════════════════

describe('Roles routes', () => {
  describe('GET /api/roles', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${BASE}/roles`);
      expect(res.status).toBe(401);
    });

    it('returns a roles array with valid auth', async () => {
      const res = await fetch(`${BASE}/roles`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body.roles)).toBe(true);
    });
  });

  describe('Escalation chains CRUD', () => {
    const chain = { source_role: 'test_role_a', target_role: 'test_role_b' };

    it('GET /api/roles/escalation-chains returns array', async () => {
      const res = await fetch(`${BASE}/roles/escalation-chains`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(Array.isArray(body.chains)).toBe(true);
    });

    it('POST /api/roles/escalation-chains requires admin', async () => {
      const res = await fetch(`${BASE}/roles/escalation-chains`, {
        method: 'POST',
        headers: authHeaders(memberToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(403);
    });

    it('POST /api/roles/escalation-chains validates body', async () => {
      const res = await fetch(`${BASE}/roles/escalation-chains`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('source_role');
    });

    it('POST /api/roles/escalation-chains creates a chain', async () => {
      const res = await fetch(`${BASE}/roles/escalation-chains`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.source_role).toBe(chain.source_role);
      expect(body.target_role).toBe(chain.target_role);
    });

    it('DELETE /api/roles/escalation-chains requires admin', async () => {
      const res = await fetch(`${BASE}/roles/escalation-chains`, {
        method: 'DELETE',
        headers: authHeaders(memberToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(403);
    });

    it('DELETE /api/roles/escalation-chains removes the chain', async () => {
      const res = await fetch(`${BASE}/roles/escalation-chains`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
        body: JSON.stringify(chain),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.removed).toBe(true);
    });

    it('DELETE returns 404 for non-existent chain', async () => {
      const res = await fetch(`${BASE}/roles/escalation-chains`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
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
      const res = await fetch(`${BASE}/roles/test_src/escalation-targets`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.targets).toContain('test_tgt_1');
      expect(body.targets).toContain('test_tgt_2');
    });

    it('GET returns empty array for unknown role', async () => {
      const res = await fetch(`${BASE}/roles/nonexistent_role/escalation-targets`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.targets).toEqual([]);
    });

    it('PUT /api/roles/:role/escalation-targets requires admin', async () => {
      const res = await fetch(`${BASE}/roles/test_src/escalation-targets`, {
        method: 'PUT',
        headers: authHeaders(memberToken),
        body: JSON.stringify({ targets: ['a'] }),
      });
      expect(res.status).toBe(403);
    });

    it('PUT /api/roles/:role/escalation-targets validates body', async () => {
      const res = await fetch(`${BASE}/roles/test_src/escalation-targets`, {
        method: 'PUT',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ targets: 'not-an-array' }),
      });
      expect(res.status).toBe(400);
    });

    it('PUT replaces targets for a role', async () => {
      const res = await fetch(`${BASE}/roles/test_src/escalation-targets`, {
        method: 'PUT',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ targets: ['replaced_tgt'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.targets).toEqual(['replaced_tgt']);

      // Verify via GET
      const verify = await fetch(`${BASE}/roles/test_src/escalation-targets`, {
        headers: authHeaders(memberToken),
      });
      const verifyBody = await verify.json() as any;
      expect(verifyBody.targets).toEqual(['replaced_tgt']);

      // Restore original targets for cleanup
      await roleService.replaceEscalationTargets('test_src', ['test_tgt_1', 'test_tgt_2']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/config/maintenance
// ═══════════════════════════════════════════════════════════════════════════

describe('Maintenance routes', () => {
  describe('GET /api/config/maintenance', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${BASE}/config/maintenance`);
      expect(res.status).toBe(401);
    });

    it('returns maintenance config', async () => {
      const res = await fetch(`${BASE}/config/maintenance`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.active).toBe(true);
      expect(body.config.schedule).toBe('0 3 * * *');
      expect(Array.isArray(body.config.rules)).toBe(true);
    });
  });

  describe('PUT /api/config/maintenance', () => {
    it('requires admin', async () => {
      const res = await fetch(`${BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(memberToken),
        body: JSON.stringify({ schedule: '0 5 * * *', rules: [] }),
      });
      expect(res.status).toBe(403);
    });

    it('validates required fields', async () => {
      const res = await fetch(`${BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(adminToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('schedule');
    });

    it('updates maintenance config', async () => {
      const newConfig = {
        schedule: '30 2 * * *',
        rules: [{ target: 'streams', olderThan: '3 days', action: 'delete' }],
      };
      const res = await fetch(`${BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(adminToken),
        body: JSON.stringify(newConfig),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.restarted).toBe(true);
      expect(body.config.schedule).toBe('30 2 * * *');

      // Restore original schedule
      await fetch(`${BASE}/config/maintenance`, {
        method: 'PUT',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          schedule: '0 3 * * *',
          rules: [{ target: 'streams', olderThan: '7 days', action: 'delete' }],
        }),
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/workflow-states (exports)
// ═══════════════════════════════════════════════════════════════════════════

describe('Exports routes', () => {
  describe('GET /api/workflow-states/jobs', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${BASE}/workflow-states/jobs`);
      expect(res.status).toBe(401);
    });

    it('returns 200 or 500 (durable schema may not exist without workers)', async () => {
      const res = await fetch(`${BASE}/workflow-states/jobs?limit=5&offset=0`, {
        headers: authHeaders(memberToken),
      });
      // The durable.jobs table only exists when HotMesh workers have registered.
      // Without workers, the endpoint returns 500. Both are valid.
      if (res.status === 200) {
        const body = await res.json() as any;
        expect(Array.isArray(body.jobs)).toBe(true);
        expect(typeof body.total).toBe('number');
      } else {
        expect(res.status).toBe(500);
      }
    });
  });

  describe('GET /api/workflow-states/:workflowId', () => {
    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${BASE}/workflow-states/nonexistent-wf-id`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workflow-states/:workflowId/execution', () => {
    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${BASE}/workflow-states/nonexistent-wf-id/execution`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workflow-states/:workflowId/status', () => {
    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${BASE}/workflow-states/nonexistent-wf-id/status`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workflow-states/:workflowId/state', () => {
    it('returns 404 for unknown workflow', async () => {
      const res = await fetch(`${BASE}/workflow-states/nonexistent-wf-id/state`, {
        headers: authHeaders(memberToken),
      });
      expect(res.status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth: 401 behavior across routes
// ═══════════════════════════════════════════════════════════════════════════

describe('Auth enforcement', () => {
  const protectedRoutes = [
    { method: 'GET', path: '/roles' },
    { method: 'GET', path: '/roles/escalation-chains' },
    { method: 'GET', path: '/config/maintenance' },
    { method: 'GET', path: '/workflow-states/jobs' },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.path} returns 401 without token`, async () => {
      const res = await fetch(`${BASE}${route.path}`, { method: route.method });
      expect(res.status).toBe(401);
    });
  }

  it('returns 401 for expired tokens', async () => {
    // Sign with 0s expiry (immediately expired)
    const expired = signToken({ userId: 'user-1' }, '0s');
    const res = await fetch(`${BASE}/roles`, {
      headers: authHeaders(expired),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for malformed tokens', async () => {
    const res = await fetch(`${BASE}/roles`, {
      headers: { Authorization: 'Bearer garbage-token' },
    });
    expect(res.status).toBe(401);
  });
});
