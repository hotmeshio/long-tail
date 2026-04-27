import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4621);

describe('Task routes', () => {
  describe('POST /api/tasks (create)', () => {
    const validTask = {
      workflow_id: 'test-wf-123',
      workflow_type: 'testWorkflow',
      lt_type: 'workflow',
      signal_id: 'sig-test-123',
      parent_workflow_id: 'test-wf-123',
      envelope: '{"data":{"key":"value"}}',
    };

    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validTask),
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 when workflow_id is missing', async () => {
      const { workflow_id, ...missing } = validTask;
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(missing),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('workflow_id');
    });

    it('returns 400 when workflow_type is missing', async () => {
      const { workflow_type, ...missing } = validTask;
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(missing),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('workflow_type');
    });

    it('returns 400 when lt_type is missing', async () => {
      const { lt_type, ...missing } = validTask;
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(missing),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('lt_type');
    });

    it('returns 400 when signal_id is missing', async () => {
      const { signal_id, ...missing } = validTask;
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(missing),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('signal_id');
    });

    it('returns 400 when parent_workflow_id is missing', async () => {
      const { parent_workflow_id, ...missing } = validTask;
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(missing),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('parent_workflow_id');
    });

    it('creates a task with valid input', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify(validTask),
      });
      const body = await res.json() as any;
      expect(res.status).toBe(201);
      expect(body).toHaveProperty('id');
      expect(body.workflow_id).toBe(validTask.workflow_id);
      expect(body.workflow_type).toBe(validTask.workflow_type);
      expect(body.lt_type).toBe(validTask.lt_type);
      expect(body.signal_id).toBe(validTask.signal_id);
      expect(body.status).toBe('pending');
    });

    it('creates a task with optional fields', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({
          ...validTask,
          workflow_id: 'test-wf-optional',
          signal_id: 'sig-optional',
          task_queue: 'test-queue',
          origin_id: 'origin-123',
          priority: 1,
          metadata: { source: 'test' },
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.task_queue).toBe('test-queue');
      expect(body.origin_id).toBe('origin-123');
      expect(body.priority).toBe(1);
    });

    it('defaults envelope to empty object when omitted', async () => {
      const { envelope, ...noEnvelope } = validTask;
      const res = await fetch(`${ctx.BASE}/tasks`, {
        method: 'POST',
        headers: authHeaders(ctx.memberToken),
        body: JSON.stringify({ ...noEnvelope, workflow_id: 'test-wf-no-env', signal_id: 'sig-no-env' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.envelope).toBe('{}');
    });
  });

  describe('GET /api/tasks', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`);
      expect(res.status).toBe(401);
    });

    it('returns tasks array with total', async () => {
      const res = await fetch(`${ctx.BASE}/tasks`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('tasks');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports pagination params', async () => {
      const res = await fetch(`${ctx.BASE}/tasks?limit=2&offset=0`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tasks.length).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/nonexistent-id`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown task ID', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/00000000-0000-0000-0000-000000000099`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /api/tasks/processes/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/stats`);
      expect(res.status).toBe(401);
    });

    it('returns stats counts', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/stats`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body).toBe('object');
      // Stats should contain numeric count fields
      expect(typeof body.total).toBe('number');
    });
  });

  describe('GET /api/tasks/processes', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes`);
      expect(res.status).toBe(401);
    });

    it('returns processes array', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('processes');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.processes)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('supports pagination', async () => {
      const res = await fetch(`${ctx.BASE}/tasks?limit=1&offset=0`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tasks.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/tasks/processes/:originId', () => {
    it('returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/nonexistent-origin`);
      expect(res.status).toBe(401);
    });

    it('returns tasks and escalations for unknown origin (empty)', async () => {
      const res = await fetch(`${ctx.BASE}/tasks/processes/nonexistent-origin-id`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('origin_id', 'nonexistent-origin-id');
      expect(body).toHaveProperty('tasks');
      expect(body).toHaveProperty('escalations');
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(Array.isArray(body.escalations)).toBe(true);
    });
  });
});
