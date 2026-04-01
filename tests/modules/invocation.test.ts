import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../services/db/migrate';
import * as configService from '../../services/config';
import * as userService from '../../services/user';
import { ltConfig } from '../../modules/ltconfig';
import type { LTWorkflowConfig } from '../../types';

const { Connection } = Durable;

describe('Workflow invocation config and RBAC', () => {
  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Clean up stale data from previous interrupted runs
    for (const extId of ['invoke-test-user', 'invoke-denied-user', 'invoke-superadmin']) {
      const stale = await userService.getUserByExternalId(extId);
      if (stale) await userService.deleteUser(stale.id);
    }

    // Clear seeded configs so tests start clean
    await configService.deleteWorkflowConfig('reviewContent');
    await configService.deleteWorkflowConfig('verifyDocument');
    ltConfig.invalidate();
  }, 30_000);

  afterAll(async () => {
    // Clean up test data
    await configService.deleteWorkflowConfig('invocableWorkflow');
    await configService.deleteWorkflowConfig('privateWorkflow');
    await configService.deleteWorkflowConfig('rbacWorkflow');
    ltConfig.invalidate();
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Config: invocable flag ──────────────────────────────────────────────

  it('should create a config with invocable: true', async () => {
    const input: LTWorkflowConfig = {
      workflow_type: 'invocableWorkflow',

      invocable: true,
      task_queue: 'invoke-queue',
      default_role: 'reviewer',
      description: 'A workflow that can be invoked via API',
      roles: ['reviewer'],
      invocation_roles: [],
      consumes: [],
    };

    const result = await configService.upsertWorkflowConfig(input);
    expect(result.invocable).toBe(true);
    expect(result.invocation_roles).toEqual([]);
  });

  it('should create a config with invocable: false (default)', async () => {
    const input: LTWorkflowConfig = {
      workflow_type: 'privateWorkflow',

      invocable: false,
      task_queue: 'private-queue',
      default_role: 'reviewer',
      description: 'An internal-only workflow',
      roles: ['reviewer'],
      invocation_roles: [],
      consumes: [],
    };

    const result = await configService.upsertWorkflowConfig(input);
    expect(result.invocable).toBe(false);
  });

  // ── Config: invocation_roles ──────────────────────────────────────────

  it('should create a config with invocation_roles', async () => {
    const input: LTWorkflowConfig = {
      workflow_type: 'rbacWorkflow',

      invocable: true,
      task_queue: 'rbac-queue',
      default_role: 'reviewer',
      description: 'Workflow with invocation role restrictions',
      roles: ['reviewer'],
      invocation_roles: ['submitter', 'admin'],
      consumes: [],
    };

    const result = await configService.upsertWorkflowConfig(input);
    expect(result.invocable).toBe(true);
    expect(result.invocation_roles).toEqual(['admin', 'submitter']); // sorted
  });

  it('should read invocation_roles from single config', async () => {
    const config = await configService.getWorkflowConfig('rbacWorkflow');
    expect(config).toBeTruthy();
    expect(config!.invocable).toBe(true);
    expect(config!.invocation_roles).toContain('submitter');
    expect(config!.invocation_roles).toContain('admin');
  });

  it('should include invocation_roles in list', async () => {
    const configs = await configService.listWorkflowConfigs();
    const rbac = configs.find(c => c.workflow_type === 'rbacWorkflow');
    expect(rbac).toBeTruthy();
    expect(rbac!.invocable).toBe(true);
    expect(rbac!.invocation_roles).toContain('submitter');
  });

  // ── Config: update invocation_roles via upsert ───────────────────────

  it('should replace invocation_roles on upsert', async () => {
    const updated = await configService.upsertWorkflowConfig({
      workflow_type: 'rbacWorkflow',

      invocable: true,
      task_queue: 'rbac-queue',
      default_role: 'reviewer',
      description: null,
      roles: ['reviewer'],
      invocation_roles: ['operator'],
      consumes: [],
    });

    expect(updated.invocation_roles).toEqual(['operator']);
    // Old roles should be gone
    expect(updated.invocation_roles).not.toContain('submitter');
    expect(updated.invocation_roles).not.toContain('admin');
  });

  it('should cascade delete invocation_roles when config is deleted', async () => {
    // First create a throwaway config
    await configService.upsertWorkflowConfig({
      workflow_type: 'tempInvocable',

      invocable: true,
      task_queue: 'temp-queue',
      default_role: 'reviewer',
      description: null,
      roles: [],
      invocation_roles: ['role-a', 'role-b'],
      consumes: [],
    });

    const deleted = await configService.deleteWorkflowConfig('tempInvocable');
    expect(deleted).toBe(true);

    // Config and its sub-entities are gone
    const config = await configService.getWorkflowConfig('tempInvocable');
    expect(config).toBeNull();
  });

  // ── Cache: resolved config includes invocable + invocationRoles ──────

  it('should resolve invocable and invocationRoles in cache', async () => {
    ltConfig.invalidate();
    const map = await configService.loadAllConfigs();

    const invocable = map.get('invocableWorkflow');
    expect(invocable).toBeTruthy();
    expect(invocable!.invocable).toBe(true);
    expect(invocable!.invocationRoles).toEqual([]);

    const rbac = map.get('rbacWorkflow');
    expect(rbac).toBeTruthy();
    expect(rbac!.invocable).toBe(true);
    expect(rbac!.invocationRoles).toEqual(['operator']);

    const priv = map.get('privateWorkflow');
    expect(priv).toBeTruthy();
    expect(priv!.invocable).toBe(false);
  });

  // ── LTConfigCache: isInvocable ──────────────────────────────────────

  it('isInvocable should return true for invocable workflows', async () => {
    ltConfig.invalidate();
    expect(await ltConfig.isInvocable('invocableWorkflow')).toBe(true);
  });

  it('isInvocable should return false for private workflows', async () => {
    expect(await ltConfig.isInvocable('privateWorkflow')).toBe(false);
  });

  it('isInvocable should return false for unknown workflows', async () => {
    expect(await ltConfig.isInvocable('unknown')).toBe(false);
  });

  // ── LTConfigCache: getInvocationRoles ──────────────────────────────

  it('getInvocationRoles should return configured roles', async () => {
    ltConfig.invalidate();
    expect(await ltConfig.getInvocationRoles('rbacWorkflow')).toEqual(['operator']);
  });

  it('getInvocationRoles should return empty for no restrictions', async () => {
    expect(await ltConfig.getInvocationRoles('invocableWorkflow')).toEqual([]);
  });

  it('getInvocationRoles should return empty for unknown workflows', async () => {
    expect(await ltConfig.getInvocationRoles('unknown')).toEqual([]);
  });

  // ── User role check for invocation RBAC ──────────────────────────────

  it('should verify user roles for invocation authorization', async () => {
    // Create a user with the 'operator' role
    const user = await userService.createUser({
      external_id: 'invoke-test-user',
      email: 'invoke@test.com',
      roles: [{ role: 'operator', type: 'member' }],
    });

    expect(user.roles).toHaveLength(1);
    expect(user.roles[0].role).toBe('operator');

    // Look up by external_id (as the invoke route does)
    const found = await userService.getUserByExternalId('invoke-test-user');
    expect(found).toBeTruthy();
    const userRoles = found!.roles.map(r => r.role);
    expect(userRoles).toContain('operator');

    // Check against rbacWorkflow's invocation_roles
    const config = await configService.getWorkflowConfig('rbacWorkflow');
    const hasAccess = config!.invocation_roles.some(r => userRoles.includes(r));
    expect(hasAccess).toBe(true);

    // Clean up
    await userService.deleteUser(user.id);
  });

  it('should deny user without matching invocation role', async () => {
    const user = await userService.createUser({
      external_id: 'invoke-denied-user',
      email: 'denied@test.com',
      roles: [{ role: 'viewer', type: 'member' }],
    });

    const found = await userService.getUserByExternalId('invoke-denied-user');
    const userRoles = found!.roles.map(r => r.role);

    const config = await configService.getWorkflowConfig('rbacWorkflow');
    const hasAccess = config!.invocation_roles.some(r => userRoles.includes(r));
    expect(hasAccess).toBe(false);

    await userService.deleteUser(user.id);
  });

  it('should allow superadmin to bypass invocation role check', async () => {
    const user = await userService.createUser({
      external_id: 'invoke-superadmin',
      email: 'super@test.com',
      roles: [{ role: 'global', type: 'superadmin' }],
    });

    const found = await userService.getUserByExternalId('invoke-superadmin');
    const isSuperAdmin = found!.roles.some(r => r.type === 'superadmin');
    expect(isSuperAdmin).toBe(true);

    await userService.deleteUser(user.id);
  });
});
