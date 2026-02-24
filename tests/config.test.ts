import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from './setup';
import { connectTelemetry, disconnectTelemetry } from './setup/telemetry';
import { migrate } from '../services/db/migrate';
import * as configService from '../services/config';
import { ltConfig } from '../modules/ltconfig';
import { ltGetWorkflowConfig } from '../interceptor/activities/config';
import type { LTWorkflowConfig } from '../types';

const { Connection } = Durable;

describe('LTConfig service and cache', () => {
  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Clear seeded configs from migration so tests start clean
    await configService.deleteWorkflowConfig('reviewContent');
    await configService.deleteWorkflowConfig('reviewContentOrchestrator');
    await configService.deleteWorkflowConfig('verifyDocument');
    await configService.deleteWorkflowConfig('verifyDocumentOrchestrator');
    ltConfig.invalidate();
  }, 30_000);

  afterAll(async () => {
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── CRUD: create ──────────────────────────────────────────────────────────

  it('should create a workflow config with all sub-entities', async () => {
    const input: LTWorkflowConfig = {
      workflow_type: 'testWorkflow',
      is_lt: true,
      is_container: false,
      task_queue: 'test-queue',
      default_role: 'reviewer',
      default_modality: 'portal',
      description: 'Test workflow',
      roles: ['reviewer', 'admin'],
      lifecycle: {
        onBefore: [{ target_workflow_type: 'fetchData', target_task_queue: 'fetch-queue', ordinal: 0 }],
        onAfter: [{ target_workflow_type: 'notify', target_task_queue: null, ordinal: 0 }],
      },
      consumers: [
        { provider_name: 'userProfile', provider_workflow_type: 'fetchUserProfile', ordinal: 0 },
      ],
    };

    const result = await configService.upsertWorkflowConfig(input);
    expect(result.workflow_type).toBe('testWorkflow');
    expect(result.is_lt).toBe(true);
    expect(result.is_container).toBe(false);
    expect(result.task_queue).toBe('test-queue');
    expect(result.default_role).toBe('reviewer');
    expect(result.default_modality).toBe('portal');
    expect(result.roles).toEqual(['admin', 'reviewer']); // sorted
    expect(result.lifecycle.onBefore).toHaveLength(1);
    expect(result.lifecycle.onBefore[0].target_workflow_type).toBe('fetchData');
    expect(result.lifecycle.onAfter).toHaveLength(1);
    expect(result.consumers).toHaveLength(1);
    expect(result.consumers[0].provider_name).toBe('userProfile');
  });

  // ── CRUD: read ────────────────────────────────────────────────────────────

  it('should read a workflow config by type', async () => {
    const config = await configService.getWorkflowConfig('testWorkflow');
    expect(config).toBeTruthy();
    expect(config!.workflow_type).toBe('testWorkflow');
    expect(config!.roles).toContain('reviewer');
    expect(config!.roles).toContain('admin');
  });

  it('should return null for unknown workflow type', async () => {
    const config = await configService.getWorkflowConfig('nonexistent');
    expect(config).toBeNull();
  });

  // ── CRUD: list ────────────────────────────────────────────────────────────

  it('should list all workflow configs', async () => {
    // Add a second config
    await configService.upsertWorkflowConfig({
      workflow_type: 'testContainer',
      is_lt: false,
      is_container: true,
      task_queue: 'container-queue',
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    const configs = await configService.listWorkflowConfigs();
    expect(configs.length).toBeGreaterThanOrEqual(2);
    const names = configs.map(c => c.workflow_type);
    expect(names).toContain('testWorkflow');
    expect(names).toContain('testContainer');
  });

  // ── CRUD: update (upsert) ─────────────────────────────────────────────────

  it('should update an existing config via upsert', async () => {
    const updated = await configService.upsertWorkflowConfig({
      workflow_type: 'testWorkflow',
      is_lt: true,
      is_container: false,
      task_queue: 'updated-queue',
      default_role: 'senior-reviewer',
      default_modality: 'fax',
      description: 'Updated description',
      roles: ['senior-reviewer'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    expect(updated.task_queue).toBe('updated-queue');
    expect(updated.default_role).toBe('senior-reviewer');
    expect(updated.default_modality).toBe('fax');
    expect(updated.roles).toEqual(['senior-reviewer']);
    expect(updated.lifecycle.onBefore).toHaveLength(0);
    expect(updated.consumers).toHaveLength(0);
  });

  // ── CRUD: delete ──────────────────────────────────────────────────────────

  it('should delete a config and cascade sub-entities', async () => {
    const deleted = await configService.deleteWorkflowConfig('testContainer');
    expect(deleted).toBe(true);

    const config = await configService.getWorkflowConfig('testContainer');
    expect(config).toBeNull();
  });

  it('should return false when deleting nonexistent config', async () => {
    const deleted = await configService.deleteWorkflowConfig('nonexistent');
    expect(deleted).toBe(false);
  });

  // ── Cache: loadAllConfigs ─────────────────────────────────────────────────

  it('should load all configs into a resolved map', async () => {
    const map = await configService.loadAllConfigs();
    const resolved = map.get('testWorkflow');
    expect(resolved).toBeTruthy();
    expect(resolved!.isLT).toBe(true);
    expect(resolved!.isContainer).toBe(false);
    expect(resolved!.role).toBe('senior-reviewer');
    expect(resolved!.modality).toBe('fax');
  });

  // ── LTConfigCache methods ─────────────────────────────────────────────────

  it('isLTWorkflow should return true for LT workflows', async () => {
    ltConfig.invalidate();
    expect(await ltConfig.isLTWorkflow('testWorkflow')).toBe(true);
  });

  it('isLTWorkflow should return false for unknown workflows', async () => {
    expect(await ltConfig.isLTWorkflow('unknown')).toBe(false);
  });

  it('isContainer should return false for non-container workflows', async () => {
    expect(await ltConfig.isContainer('testWorkflow')).toBe(false);
  });

  it('getTargetEscalationRole should return configured role', async () => {
    expect(await ltConfig.getTargetEscalationRole('testWorkflow')).toBe('senior-reviewer');
  });

  it('getTargetEscalationRole should return default for unknown', async () => {
    expect(await ltConfig.getTargetEscalationRole('unknown')).toBe('reviewer');
  });

  it('getAllowedEscalationRoles should return configured roles', async () => {
    expect(await ltConfig.getAllowedEscalationRoles('testWorkflow')).toEqual(['senior-reviewer']);
  });

  it('getDefaultModality should return configured modality', async () => {
    expect(await ltConfig.getDefaultModality('testWorkflow')).toBe('fax');
  });

  it('hasOnBefore/hasOnAfter should return false when no hooks', async () => {
    expect(await ltConfig.hasOnBefore('testWorkflow')).toBe(false);
    expect(await ltConfig.hasOnAfter('testWorkflow')).toBe(false);
  });

  it('getProviders should return empty for no consumers', async () => {
    expect(await ltConfig.getProviders('testWorkflow')).toEqual([]);
  });

  it('getResolvedConfig should return full config', async () => {
    const config = await ltConfig.getResolvedConfig('testWorkflow');
    expect(config).toBeTruthy();
    expect(config!.isLT).toBe(true);
    expect(config!.role).toBe('senior-reviewer');
  });

  it('getResolvedConfig should return null for unknown', async () => {
    const config = await ltConfig.getResolvedConfig('unknown');
    expect(config).toBeNull();
  });

  // ── Cache invalidation ────────────────────────────────────────────────────

  it('should reflect changes after invalidation', async () => {
    // Update config directly
    await configService.upsertWorkflowConfig({
      workflow_type: 'testWorkflow',
      is_lt: true,
      is_container: false,
      task_queue: 'final-queue',
      default_role: 'moderator',
      default_modality: 'phone',
      description: null,
      roles: ['moderator'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    // Before invalidation, cache still has old value
    expect(await ltConfig.getTargetEscalationRole('testWorkflow')).toBe('senior-reviewer');

    // After invalidation, new value
    ltConfig.invalidate();
    expect(await ltConfig.getTargetEscalationRole('testWorkflow')).toBe('moderator');
  });

  // ── Activity config bridge: uses cache ──────────────────────────────────

  it('ltGetWorkflowConfig should resolve from cache', async () => {
    ltConfig.invalidate();

    // First call loads from DB into cache
    const config1 = await ltGetWorkflowConfig('testWorkflow');
    expect(config1).toBeTruthy();
    expect(config1!.isLT).toBe(true);
    expect(config1!.role).toBe('moderator');

    // Second call within TTL should return cached data
    const config2 = await ltGetWorkflowConfig('testWorkflow');
    expect(config2).toEqual(config1);
  });

  it('ltGetWorkflowConfig should return null for unregistered workflows', async () => {
    const config = await ltGetWorkflowConfig('unregisteredWorkflow');
    expect(config).toBeNull();
  });

  it('ltGetWorkflowConfig should reflect config changes after invalidation', async () => {
    // Current value
    const before = await ltGetWorkflowConfig('testWorkflow');
    expect(before!.role).toBe('moderator');

    // Update config in DB
    await configService.upsertWorkflowConfig({
      workflow_type: 'testWorkflow',
      is_lt: true,
      is_container: false,
      task_queue: 'final-queue',
      default_role: 'supervisor',
      default_modality: 'phone',
      description: null,
      roles: ['supervisor'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    // Still returns old value (cached)
    const stale = await ltGetWorkflowConfig('testWorkflow');
    expect(stale!.role).toBe('moderator');

    // After invalidation, returns new value
    ltConfig.invalidate();
    const fresh = await ltGetWorkflowConfig('testWorkflow');
    expect(fresh!.role).toBe('supervisor');

    // Restore original value for cleanup test
    await configService.upsertWorkflowConfig({
      workflow_type: 'testWorkflow',
      is_lt: true,
      is_container: false,
      task_queue: 'final-queue',
      default_role: 'moderator',
      default_modality: 'phone',
      description: null,
      roles: ['moderator'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });
    ltConfig.invalidate();
  });

  // ── Config-driven routing decisions ────────────────────────────────────

  it('should identify LT workflows via config', async () => {
    ltConfig.invalidate();
    const config = await ltGetWorkflowConfig('testWorkflow');
    expect(config).toBeTruthy();
    expect(config!.isLT).toBe(true);
    expect(config!.isContainer).toBe(false);
  });

  it('should identify container workflows via config', async () => {
    // Create a container config
    await configService.upsertWorkflowConfig({
      workflow_type: 'testContainerRouting',
      is_lt: false,
      is_container: true,
      task_queue: 'container-queue',
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });
    ltConfig.invalidate();

    const config = await ltGetWorkflowConfig('testContainerRouting');
    expect(config).toBeTruthy();
    expect(config!.isContainer).toBe(true);
    expect(config!.isLT).toBe(false);

    await configService.deleteWorkflowConfig('testContainerRouting');
    ltConfig.invalidate();
  });

  it('should return null for pass-through (unregistered) workflows', async () => {
    ltConfig.invalidate();
    const config = await ltGetWorkflowConfig('plainWorkflowNoConfig');
    expect(config).toBeNull();
    // Interceptor would call next() for this workflow (pass-through)
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  it('should clean up test configs', async () => {
    await configService.deleteWorkflowConfig('testWorkflow');
    ltConfig.invalidate();
    expect(await ltConfig.isLTWorkflow('testWorkflow')).toBe(false);
  });
});
