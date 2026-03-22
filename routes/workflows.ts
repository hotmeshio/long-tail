import { Router } from 'express';
import { Durable } from '@hotmeshio/hotmesh';

import { createClient } from '../workers';
import * as exportService from '../services/export';
import * as configService from '../services/config';
import * as userService from '../services/user';
import { requireAdmin } from '../modules/auth';
import { ltConfig } from '../modules/ltconfig';
import { cronRegistry } from '../services/cron';
import { JOB_EXPIRE_SECS } from '../modules/defaults';
import { resolveHandle } from './resolve';
import type { LTEnvelope } from '../types';

const router = Router();

// ── Cron status ─────────────────────────────────────────────────────────────

/**
 * GET /api/workflows/cron/status
 * List all cron-configured workflows and whether each is actively running.
 */
router.get('/cron/status', async (_req, res) => {
  try {
    const configs = await configService.listWorkflowConfigs();
    const cronConfigs = configs.filter((c) => c.cron_schedule);
    const activeTypes = cronRegistry.activeWorkflowTypes;

    const schedules = cronConfigs.map((c) => ({
      workflow_type: c.workflow_type,
      cron_schedule: c.cron_schedule,
      description: c.description,
      task_queue: c.task_queue,
      invocable: c.invocable,
      active: activeTypes.includes(c.workflow_type),
      envelope_schema: c.envelope_schema,
    }));

    res.json({ schedules });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workflow configuration ────────────────────────────────────────────────────

/**
 * GET /api/workflows/config
 * List all workflow configurations.
 */
router.get('/config', async (_req, res) => {
  try {
    const configs = await configService.listWorkflowConfigs();
    res.json({ workflows: configs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:type/config
 * Get a single workflow configuration.
 */
router.get('/:type/config', async (req, res) => {
  try {
    const config = await configService.getWorkflowConfig(req.params.type);
    if (!config) {
      res.status(404).json({ error: 'Workflow config not found' });
      return;
    }
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/workflows/:type/config
 * Create or replace a workflow configuration.
 * Requires admin or superadmin role.
 */
router.put('/:type/config', requireAdmin, async (req, res) => {
  try {
    const config = await configService.upsertWorkflowConfig({
      workflow_type: req.params.type as string,
      invocable: req.body.invocable ?? false,
      task_queue: req.body.task_queue ?? null,
      default_role: req.body.default_role ?? 'reviewer',
      default_modality: req.body.default_modality ?? 'portal',
      description: req.body.description ?? null,
      roles: req.body.roles ?? [],
      invocation_roles: req.body.invocation_roles ?? [],
      consumes: req.body.consumes ?? [],
      tool_tags: req.body.tool_tags ?? [],
      envelope_schema: req.body.envelope_schema ?? null,
      resolver_schema: req.body.resolver_schema ?? null,
      cron_schedule: req.body.cron_schedule ?? null,
    });
    ltConfig.invalidate();
    // Restart cron if schedule changed
    await cronRegistry.restartCron(config);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/workflows/:type/config
 * Delete a workflow configuration and all sub-entities (cascade).
 * Requires admin or superadmin role.
 */
router.delete('/:type/config', requireAdmin, async (req, res) => {
  try {
    const deleted = await configService.deleteWorkflowConfig(req.params.type as string);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow config not found' });
      return;
    }
    ltConfig.invalidate();
    res.json({ deleted: true, workflow_type: req.params.type });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workflow invocation ─────────────────────────────────────────────────────

/**
 * POST /api/workflows/:type/invoke
 * Start a workflow by its registered type.
 *
 * The workflow must have `invocable: true` in its config. If the config
 * includes `invocation_roles`, the authenticated user must hold at least
 * one of those roles. When invocation_roles is empty, any authenticated
 * user can invoke.
 *
 * Body: { data: Record<string, any>, metadata?: Record<string, any> }
 */
router.post('/:type/invoke', async (req, res) => {
  try {
    const workflowType = req.params.type;

    // 1. Look up workflow config
    const wfConfig = await configService.getWorkflowConfig(workflowType);
    if (!wfConfig) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    // 2. Check invocable flag
    if (!wfConfig.invocable) {
      res.status(403).json({ error: 'Workflow is not invocable' });
      return;
    }

    // 3. Check invocation roles (if configured)
    if (wfConfig.invocation_roles.length > 0) {
      const userId = req.auth!.userId;
      const user = await userService.getUserByExternalId(userId);
      if (!user) {
        res.status(403).json({ error: 'User not registered' });
        return;
      }
      const userRoles = user.roles.map((r) => r.role);
      const hasInvocationRole = wfConfig.invocation_roles.some((r) =>
        userRoles.includes(r),
      );
      if (!hasInvocationRole) {
        const isSuperAdmin = user.roles.some((r) => r.type === 'superadmin');
        if (!isSuperAdmin) {
          res.status(403).json({ error: 'Insufficient role for invocation' });
          return;
        }
      }
    }

    // 4. Build envelope and start workflow
    const { data, metadata } = req.body || {};
    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'Request body must include a data object' });
      return;
    }

    const envelope: LTEnvelope = {
      data,
      metadata: metadata || {},
    };

    if (!wfConfig.task_queue) {
      res.status(400).json({ error: 'Workflow has no task_queue configured' });
      return;
    }

    const client = createClient();
    const workflowId = `${workflowType}-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [envelope],
      taskQueue: wfConfig.task_queue,
      workflowName: workflowType,
      workflowId,
      expire: JOB_EXPIRE_SECS,
      entity: workflowType,
    } as any);

    res.status(202).json({
      workflowId: handle.workflowId,
      message: 'Workflow started',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workflow observation ────────────────────────────────────────────────────

/**
 * GET /api/workflows/:workflowId/status
 * Get the status of a workflow. Only the workflowId is needed.
 */
router.get('/:workflowId/status', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      req.params.workflowId,
    );
    const status = await handle.status();
    res.json({ workflowId: req.params.workflowId, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:workflowId/result
 * Return the workflow result if complete, or 202 if still running.
 * Never blocks — always returns immediately.
 */
router.get('/:workflowId/result', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      req.params.workflowId,
    );
    const status = await handle.status();

    if (status !== 0) {
      res.status(202).json({
        workflowId: req.params.workflowId,
        status: 'running',
      });
      return;
    }

    const result = await handle.result();
    res.json({ workflowId: req.params.workflowId, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workflows/:workflowId/terminate
 * Interrupt/terminate a running workflow.
 */
router.post('/:workflowId/terminate', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      req.params.workflowId,
    );

    await handle.interrupt();

    res.json({ terminated: true, workflowId: req.params.workflowId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:workflowId/export
 * Export workflow state. Convenience alias for /api/workflow-states/:workflowId.
 */
router.get('/:workflowId/export', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const exported = await exportService.exportWorkflow(
      req.params.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
    );
    res.json(exported);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
