import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { start } from '../../../start';
import { createTask, getTask } from '../../../services/task';
import { createUser, deleteUser } from '../../../services/user';
import type { LTInstance } from '../../../types/startup';
import type { LTStartConfig } from '../../../types/startup';
import { loggerRegistry } from '../../../services/logger';
import { telemetryRegistry } from '../../../services/telemetry';
import { eventRegistry } from '../../../services/events';
import { maintenanceRegistry } from '../../../services/maintenance';

const TEST_DB = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: 'longtail_test',
};

let lt: LTInstance;
let testUserId: string;

function clearRegistries() {
  loggerRegistry.clear();
  telemetryRegistry.clear();
  eventRegistry.clear();
  maintenanceRegistry.clear();
}

describe('Audit trail — initiated_by on tasks', () => {
  beforeAll(async () => {
    clearRegistries();
    lt = await start({
      database: TEST_DB,
      server: { port: 4650 },
      auth: { secret: 'audit-test-secret' },
    } as LTStartConfig);

    // Create a real user for FK references
    const user = await createUser({ external_id: `audit-test-user-${Date.now()}` });
    testUserId = user.id;
  }, 30_000);

  afterAll(async () => {
    await deleteUser(testUserId).catch(() => {});
    await lt.shutdown();
    clearRegistries();
  }, 15_000);

  it('creates task with initiated_by when userId provided', async () => {
    const task = await createTask({
      workflow_id: `audit-test-${Date.now()}`,
      workflow_type: 'testWorkflow',
      lt_type: 'testWorkflow',
      signal_id: `sig-${Date.now()}`,
      parent_workflow_id: 'parent-1',
      envelope: '{}',
      initiated_by: testUserId,
      principal_type: 'user',
    });

    expect(task.initiated_by).toBe(testUserId);
    expect(task.principal_type).toBe('user');
  });

  it('creates task with null initiated_by when not provided', async () => {
    const task = await createTask({
      workflow_id: `audit-test-null-${Date.now()}`,
      workflow_type: 'testWorkflow',
      lt_type: 'testWorkflow',
      signal_id: `sig-null-${Date.now()}`,
      parent_workflow_id: 'parent-2',
      envelope: '{}',
    });

    expect(task.initiated_by).toBeNull();
    expect(task.principal_type).toBeNull();
  });

  it('persists initiated_by and can be retrieved', async () => {
    const wfId = `audit-persist-${Date.now()}`;
    const created = await createTask({
      workflow_id: wfId,
      workflow_type: 'testWorkflow',
      lt_type: 'testWorkflow',
      signal_id: `sig-persist-${Date.now()}`,
      parent_workflow_id: 'parent-3',
      envelope: '{}',
      initiated_by: testUserId,
      principal_type: 'bot',
    });

    const retrieved = await getTask(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.initiated_by).toBe(testUserId);
    expect(retrieved!.principal_type).toBe('bot');
  });
});
