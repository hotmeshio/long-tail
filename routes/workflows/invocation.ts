import { Router } from 'express';

import { createClient } from '../../workers';
import * as exportService from '../../services/export';
import { resolveHandle } from '../resolve';
import {
  invokeWorkflow,
  checkInvocationRoles,
  InvocationError,
} from '../../services/workflow-invocation';

const router = Router();

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
    const userId = req.auth?.userId ?? '';

    // Role check (requires DB lookup, kept separate from core invoke)
    await checkInvocationRoles(workflowType, userId);

    const { data, metadata, execute_as: executeAs } = req.body || {};

    const result = await invokeWorkflow({
      workflowType,
      data,
      metadata,
      executeAs,
      auth: {
        userId,
        role: req.auth?.role,
        scopes: (req.auth as any)?.scopes,
      },
    });

    res.status(202).json({
      workflowId: result.workflowId,
      message: 'Workflow started',
    });
  } catch (err: any) {
    const status = err instanceof InvocationError ? err.statusCode : 500;
    res.status(status).json({ error: err.message });
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
