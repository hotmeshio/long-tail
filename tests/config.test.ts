import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { MemFlow } from '@hotmeshio/hotmesh';

import { postgres_options } from './setup';
import { migrate } from '../services/db/migrate';
import * as configService from '../services/config';
import { ltConfig } from '../modules/ltconfig';
import type { LTWorkflowConfig } from '../types';

const { Connection } = MemFlow;

describe('LTConfig service and cache', () => {
  beforeAll(async () => {
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
    await MemFlow.shutdown();
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

  // ── Cleanup ───────────────────────────────────────────────────────────────

  it('should clean up test configs', async () => {
    await configService.deleteWorkflowConfig('testWorkflow');
    ltConfig.invalidate();
    expect(await ltConfig.isLTWorkflow('testWorkflow')).toBe(false);
  });
});
