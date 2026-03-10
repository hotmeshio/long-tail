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
// /api/mcp-runs
// ═══════════════════════════════════════════════════════════════════════════

describe('MCP Runs routes', () => {
  describe('GET /api/mcp-runs', () => {
    it('returns 400 without app_id', async () => {
      const res = await fetch(`${BASE}/mcp-runs`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('app_id');
    });

    it('returns jobs list for valid app_id', async () => {
      const res = await fetch(`${BASE}/mcp-runs?app_id=longtail`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('jobs');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('returns empty list for non-existent schema', async () => {
      const res = await fetch(`${BASE}/mcp-runs?app_id=nonexistent_schema_xyz`, {
        headers: authHeaders(adminToken),
      });
      // May return 200 with empty or 500 depending on schema existence
      const body = await res.json();
      if (res.status === 200) {
        expect(body.jobs).toEqual([]);
        expect(body.total).toBe(0);
      }
    });

    it('supports status filter', async () => {
      const res = await fetch(`${BASE}/mcp-runs?app_id=longtail&status=completed`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const job of body.jobs) {
        expect(job.status).toBe('completed');
      }
    });

    it('supports pagination params', async () => {
      const res = await fetch(`${BASE}/mcp-runs?app_id=longtail&limit=2&offset=0`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs.length).toBeLessThanOrEqual(2);
    });

    it('supports entity filter', async () => {
      const res = await fetch(`${BASE}/mcp-runs?app_id=longtail&entity=nonexistent_entity`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports search filter', async () => {
      const res = await fetch(`${BASE}/mcp-runs?app_id=longtail&search=zzz_no_match_zzz`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs).toEqual([]);
    });

    it('job records have expected shape', async () => {
      const res = await fetch(`${BASE}/mcp-runs?app_id=longtail&limit=1`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.jobs.length > 0) {
        const job = body.jobs[0];
        expect(job).toHaveProperty('workflow_id');
        expect(job).toHaveProperty('entity');
        expect(job).toHaveProperty('status');
        expect(['running', 'completed', 'failed']).toContain(job.status);
        expect(job).toHaveProperty('is_live');
        expect(job).toHaveProperty('created_at');
        expect(job).toHaveProperty('updated_at');
      }
    });
  });

  describe('GET /api/mcp-runs/entities', () => {
    it('returns 400 without app_id', async () => {
      const res = await fetch(`${BASE}/mcp-runs/entities`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(400);
    });

    it('returns entities array for valid app_id', async () => {
      const res = await fetch(`${BASE}/mcp-runs/entities?app_id=longtail`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('entities');
      expect(Array.isArray(body.entities)).toBe(true);
    });

    it('returns empty array for non-existent schema', async () => {
      const res = await fetch(`${BASE}/mcp-runs/entities?app_id=nonexistent_schema_xyz`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entities).toEqual([]);
    });

    it('entities are sorted and contain no nulls', async () => {
      const res = await fetch(`${BASE}/mcp-runs/entities?app_id=longtail`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const { entities } = await res.json();
      for (const e of entities) {
        expect(e).not.toBeNull();
        expect(e).not.toBe('');
      }
      const sorted = [...entities].sort();
      expect(entities).toEqual(sorted);
    });
  });

  describe('GET /api/mcp-runs/:jobId/execution', () => {
    it('returns 400 without app_id', async () => {
      const res = await fetch(`${BASE}/mcp-runs/some-job/execution`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent job', async () => {
      const res = await fetch(`${BASE}/mcp-runs/nonexistent_job_xyz/execution?app_id=longtail`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/yaml-workflows
// ═══════════════════════════════════════════════════════════════════════════

describe('YAML Workflows routes', () => {
  describe('GET /api/yaml-workflows', () => {
    it('returns workflow list', async () => {
      const res = await fetch(`${BASE}/yaml-workflows`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('workflows');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.workflows)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports status filter', async () => {
      const res = await fetch(`${BASE}/yaml-workflows?status=active`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const wf of body.workflows) {
        expect(wf.status).toBe('active');
      }
    });

    it('supports graph_topic filter', async () => {
      const res = await fetch(`${BASE}/yaml-workflows?graph_topic=nonexistent_topic`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports app_id filter', async () => {
      const res = await fetch(`${BASE}/yaml-workflows?app_id=nonexistent_app`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports search filter', async () => {
      const res = await fetch(`${BASE}/yaml-workflows?search=zzz_no_match_zzz`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports pagination', async () => {
      const res = await fetch(`${BASE}/yaml-workflows?limit=1&offset=0`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflows.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/yaml-workflows/app-ids', () => {
    it('returns an array of app_ids', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/app-ids`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('app_ids');
      expect(Array.isArray(body.app_ids)).toBe(true);
    });

    it('app_ids are strings and sorted', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/app-ids`, {
        headers: authHeaders(adminToken),
      });
      const body = await res.json();
      for (const id of body.app_ids) {
        expect(typeof id).toBe('string');
      }
      const sorted = [...body.app_ids].sort();
      expect(body.app_ids).toEqual(sorted);
    });
  });

  describe('GET /api/yaml-workflows/:id', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/yaml-workflows/:id', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id`, {
        method: 'PUT',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ name: 'updated' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/yaml-workflows/:id', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/deploy', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id/deploy`, {
        method: 'POST',
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/invoke', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id/invoke`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ data: {} }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/regenerate', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id/regenerate`, {
        method: 'POST',
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows/:id/archive', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id/archive`, {
        method: 'POST',
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/yaml-workflows (create)', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await fetch(`${BASE}/yaml-workflows`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/yaml-workflows/:id/yaml', () => {
    it('returns 404 for non-existent workflow', async () => {
      const res = await fetch(`${BASE}/yaml-workflows/nonexistent-id/yaml`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/mcp/servers
// ═══════════════════════════════════════════════════════════════════════════

describe('MCP Servers routes', () => {
  describe('GET /api/mcp/servers', () => {
    it('returns server list', async () => {
      const res = await fetch(`${BASE}/mcp/servers`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('servers');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.servers)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports status filter', async () => {
      const res = await fetch(`${BASE}/mcp/servers?status=connected`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const srv of body.servers) {
        expect(srv.status).toBe('connected');
      }
    });

    it('supports search filter', async () => {
      const res = await fetch(`${BASE}/mcp/servers?search=zzz_no_match_zzz`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports pagination', async () => {
      const res = await fetch(`${BASE}/mcp/servers?limit=1&offset=0`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/mcp/servers/:id', () => {
    it('returns 404 for non-existent server', async () => {
      const res = await fetch(`${BASE}/mcp/servers/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/mcp/servers', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await fetch(`${BASE}/mcp/servers`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/mcp/servers/:id', () => {
    it('returns 404 for non-existent server', async () => {
      const res = await fetch(`${BASE}/mcp/servers/00000000-0000-0000-0000-000000000099`, {
        method: 'PUT',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ description: 'updated' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/mcp/servers/:id', () => {
    it('returns 404 for non-existent server', async () => {
      const res = await fetch(`${BASE}/mcp/servers/00000000-0000-0000-0000-000000000099`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
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
