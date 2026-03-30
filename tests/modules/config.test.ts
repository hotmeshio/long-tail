import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../services/db/migrate';
import * as configService from '../../services/config';
import { ltConfig } from '../../modules/ltconfig';
import { ltGetWorkflowConfig } from '../../services/interceptor/activities/config';
import type { LTWorkflowConfig } from '../../types';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Configuration
//
// Every workflow in the system is governed by a config record that controls
// interceptor behavior: whether it's an LT workflow, which role receives
// escalations, and more.
//
// This suite walks through:
//   1. CRUD operations on workflow configs
//   2. The in-memory cache (LTConfigCache) that the interceptor reads from
//   3. The activity bridge (ltGetWorkflowConfig) that resolves configs at runtime
//   4. Config-driven routing decisions (LT vs pass-through)
// ─────────────────────────────────────────────────────────────────────────────

describe('workflow configuration', () => {
  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Clear seeded configs from migration so tests start clean
    await configService.deleteWorkflowConfig('reviewContent');
    await configService.deleteWorkflowConfig('verifyDocument');
    ltConfig.invalidate();
  }, 30_000);

  afterAll(async () => {
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── 1. CRUD ────────────────────────────────────────────────────────────
  //
  // Configs are stored across four tables (workflows, roles, invocation_roles,
  // invocation_roles) and assembled into a single LTWorkflowConfig object.

  describe('CRUD operations', () => {
    it('should create a config with all sub-entities', async () => {
      const input: LTWorkflowConfig = {
        workflow_type: 'testWorkflow',

        invocable: false,
        task_queue: 'test-queue',
        default_role: 'reviewer',
        default_modality: 'portal',
        description: 'Test workflow',
        roles: ['reviewer', 'admin'],
        invocation_roles: [],
        consumes: ['fetchUserProfile'],
      };

      const result = await configService.upsertWorkflowConfig(input);
      expect(result.workflow_type).toBe('testWorkflow');

      expect(result.task_queue).toBe('test-queue');
      expect(result.default_role).toBe('reviewer');
      expect(result.default_modality).toBe('portal');
      expect(result.roles).toEqual(['admin', 'reviewer']); // sorted
      expect(result.consumes).toEqual(['fetchUserProfile']);
    });

    it('should read a config by type', async () => {
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

    it('should list all configs', async () => {
      await configService.upsertWorkflowConfig({
        workflow_type: 'testContainer',

        invocable: false,
        task_queue: 'container-queue',
        default_role: 'reviewer',
        default_modality: 'default',
        description: null,
        roles: [],
        invocation_roles: [],

        consumes: [],
      });

      const configs = await configService.listWorkflowConfigs();
      expect(configs.length).toBeGreaterThanOrEqual(2);
      const names = configs.map(c => c.workflow_type);
      expect(names).toContain('testWorkflow');
      expect(names).toContain('testContainer');
    });

    it('should update an existing config via upsert', async () => {
      const updated = await configService.upsertWorkflowConfig({
        workflow_type: 'testWorkflow',

        invocable: false,
        task_queue: 'updated-queue',
        default_role: 'senior-reviewer',
        default_modality: 'fax',
        description: 'Updated description',
        roles: ['senior-reviewer'],
        invocation_roles: [],

        consumes: [],
      });

      expect(updated.task_queue).toBe('updated-queue');
      expect(updated.default_role).toBe('senior-reviewer');
      expect(updated.default_modality).toBe('fax');
      expect(updated.roles).toEqual(['senior-reviewer']);
      expect(updated.consumes).toHaveLength(0);
    });

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
  });

  // ── 2. In-memory cache ─────────────────────────────────────────────────
  //
  // The interceptor reads configs from LTConfigCache, which loads all
  // configs into memory on first access and invalidates on changes.

  describe('in-memory cache (LTConfigCache)', () => {
    it('should load all configs into a resolved map', async () => {
      const map = await configService.loadAllConfigs();
      const resolved = map.get('testWorkflow');
      expect(resolved).toBeTruthy();
      expect(resolved!.role).toBe('senior-reviewer');
      expect(resolved!.modality).toBe('fax');
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

    it('getProviders should return empty for no consumers', async () => {
      expect(await ltConfig.getProviders('testWorkflow')).toEqual([]);
    });

    it('getResolvedConfig should return full config', async () => {
      const config = await ltConfig.getResolvedConfig('testWorkflow');
      expect(config).toBeTruthy();
      expect(config!.role).toBe('senior-reviewer');
    });

    it('getResolvedConfig should return null for unknown', async () => {
      const config = await ltConfig.getResolvedConfig('unknown');
      expect(config).toBeNull();
    });

    it('should reflect changes after invalidation', async () => {
      await configService.upsertWorkflowConfig({
        workflow_type: 'testWorkflow',

        invocable: false,
        task_queue: 'final-queue',
        default_role: 'moderator',
        default_modality: 'phone',
        description: null,
        roles: ['moderator'],
        invocation_roles: [],

        consumes: [],
      });

      // Before invalidation, cache still has old value
      expect(await ltConfig.getTargetEscalationRole('testWorkflow')).toBe('senior-reviewer');

      // After invalidation, new value
      ltConfig.invalidate();
      expect(await ltConfig.getTargetEscalationRole('testWorkflow')).toBe('moderator');
    });
  });

  // ── 3. Activity bridge ─────────────────────────────────────────────────
  //
  // The interceptor resolves configs via ltGetWorkflowConfig, which reads
  // from the cache. This verifies cache integration end-to-end.

  describe('activity config bridge', () => {
    it('should resolve config from cache', async () => {
      ltConfig.invalidate();

      const config1 = await ltGetWorkflowConfig('testWorkflow');
      expect(config1).toBeTruthy();
      expect(config1!.role).toBe('moderator');

      // Second call within TTL returns cached data
      const config2 = await ltGetWorkflowConfig('testWorkflow');
      expect(config2).toEqual(config1);
    });

    it('should return null for unregistered workflows', async () => {
      const config = await ltGetWorkflowConfig('unregisteredWorkflow');
      expect(config).toBeNull();
    });

    it('should reflect config changes after invalidation', async () => {
      const before = await ltGetWorkflowConfig('testWorkflow');
      expect(before!.role).toBe('moderator');

      await configService.upsertWorkflowConfig({
        workflow_type: 'testWorkflow',

        invocable: false,
        task_queue: 'final-queue',
        default_role: 'supervisor',
        default_modality: 'phone',
        description: null,
        roles: ['supervisor'],
        invocation_roles: [],

        consumes: [],
      });

      // Still returns old value (cached)
      const stale = await ltGetWorkflowConfig('testWorkflow');
      expect(stale!.role).toBe('moderator');

      // After invalidation, returns new value
      ltConfig.invalidate();
      const fresh = await ltGetWorkflowConfig('testWorkflow');
      expect(fresh!.role).toBe('supervisor');

      // Restore for remaining tests
      await configService.upsertWorkflowConfig({
        workflow_type: 'testWorkflow',

        invocable: false,
        task_queue: 'final-queue',
        default_role: 'moderator',
        default_modality: 'phone',
        description: null,
        roles: ['moderator'],
        invocation_roles: [],

        consumes: [],
      });
      ltConfig.invalidate();
    });
  });

  // ── 4. Config-driven routing ───────────────────────────────────────────
  //
  // The interceptor uses config to decide how to handle a workflow:
  //   - null config → pass-through (call next())

  describe('config-driven routing decisions', () => {
    it('should return null for pass-through (unregistered) workflows', async () => {
      ltConfig.invalidate();
      const config = await ltGetWorkflowConfig('plainWorkflowNoConfig');
      expect(config).toBeNull();
    });
  });

  // ── Cleanup ────────────────────────────────────────────────────────────

  it('should clean up test configs', async () => {
    await configService.deleteWorkflowConfig('testWorkflow');
    ltConfig.invalidate();
  });
});
