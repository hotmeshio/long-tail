import { Router } from 'express';

import * as api from '../../api/workflows';

const router = Router();

// ── Workflow invocation ─────────────────────────────────────────────────────

/**
 * POST /api/workflows/:type/invoke
 * Proxy for `Durable.Client.workflow.start()` with IAM resolution.
 *
 * The workflow must have `invocable: true` in its config (or an active
 * worker). If the config includes `invocation_roles`, the authenticated
 * user must hold at least one of those roles.
 *
 * Body fields `data`, `metadata`, and `execute_as` are extracted for
 * envelope/IAM handling. Everything else in `options` passes through
 * to the Durable client unchanged (workflowId, expire, entity,
 * namespace, search, signalIn, pending, etc.).
 *
 * @see https://docs.hotmesh.io/types/types_durable.WorkflowOptions.html
 */
router.post('/:type/invoke', async (req, res) => {
  const { data, metadata, execute_as, ...options } = req.body ?? {};
  const result = await api.invokeWorkflow(
    {
      type: req.params.type,
      data,
      metadata,
      execute_as,
      options: Object.keys(options).length > 0 ? options : undefined,
    },
    { userId: req.auth?.userId ?? '' },
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Workflow observation ────────────────────────────────────────────────────

/**
 * GET /api/workflows/:workflowId/status
 * Get the status of a workflow. Only the workflowId is needed.
 */
router.get('/:workflowId/status', async (req, res) => {
  const result = await api.getWorkflowStatus({ workflowId: req.params.workflowId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflows/:workflowId/result
 * Return the workflow result if complete, or 202 if still running.
 * Never blocks — always returns immediately.
 */
router.get('/:workflowId/result', async (req, res) => {
  const result = await api.getWorkflowResult({ workflowId: req.params.workflowId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/workflows/:workflowId/terminate
 * Interrupt/terminate a running workflow.
 */
router.post('/:workflowId/terminate', async (req, res) => {
  const result = await api.terminateWorkflow({ workflowId: req.params.workflowId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflows/:workflowId/export
 * Export workflow state. Convenience alias for /api/workflow-states/:workflowId.
 */
router.get('/:workflowId/export', async (req, res) => {
  const result = await api.exportWorkflow({ workflowId: req.params.workflowId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
