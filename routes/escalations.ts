import { Router } from 'express';

import * as escalationService from '../services/escalation';
import * as taskService from '../services/task';
import { createClient, LT_TASK_QUEUE } from '../workers';

const router = Router();

/**
 * GET /api/escalations
 * List escalations with optional filters.
 */
router.get('/', async (req, res) => {
  try {
    const result = await escalationService.listEscalations({
      status: req.query.status as any,
      role: req.query.role as string,
      type: req.query.type as string,
      subtype: req.query.subtype as string,
      assigned_to: req.query.assigned_to as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/escalations/available
 * List available escalations (pending, unassigned or expired claim).
 */
router.get('/available', async (req, res) => {
  try {
    const result = await escalationService.listAvailableEscalations({
      role: req.query.role as string,
      type: req.query.type as string,
      subtype: req.query.subtype as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/release-expired
 * Optional cleanup of stale assignment data.
 */
router.post('/release-expired', async (_req, res) => {
  try {
    const released = await escalationService.releaseExpiredClaims();
    res.json({ released });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Parameterized routes (must come after literal paths) ─────────────────────

/**
 * GET /api/escalations/:id
 * Get a single escalation by ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const escalation = await escalationService.getEscalation(req.params.id);
    if (!escalation) {
      res.status(404).json({ error: 'Escalation not found' });
      return;
    }
    res.json(escalation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/:id/claim
 * Claim an escalation. userId comes from auth token.
 * Body: { durationMinutes?: number }
 */
router.post('/:id/claim', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { durationMinutes } = req.body || {};

    const result = await escalationService.claimEscalation(
      req.params.id,
      userId,
      durationMinutes,
    );

    if (!result) {
      res.status(409).json({ error: 'Escalation not available for claim' });
      return;
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/:id/resolve
 * Start a new workflow with resolver data to re-run the failed step.
 * The interceptor in the new workflow resolves the escalation record
 * and signals back to the orchestrator (if any) on success.
 * Body: { resolverPayload: Record<string, any> }
 */
router.post('/:id/resolve', async (req, res) => {
  try {
    const { resolverPayload } = req.body || {};
    if (!resolverPayload) {
      res.status(400).json({ error: 'resolverPayload is required' });
      return;
    }

    // 1. Read escalation (verify pending)
    const escalation = await escalationService.getEscalation(req.params.id);
    if (!escalation) {
      res.status(404).json({ error: 'Escalation not found' });
      return;
    }
    if (escalation.status !== 'pending') {
      res.status(409).json({ error: 'Escalation not available for resolution' });
      return;
    }

    // 2. Reconstruct the original envelope from the escalation or task
    let envelope: Record<string, any> = {};
    if (escalation.envelope) {
      try {
        envelope = JSON.parse(escalation.envelope);
      } catch { /* use empty */ }
    } else if (escalation.task_id) {
      const task = await taskService.getTask(escalation.task_id);
      if (task?.envelope) {
        try {
          envelope = JSON.parse(task.envelope);
        } catch { /* use empty */ }
      }
    }

    // 3. Inject resolver data and escalation ID into the envelope
    envelope.resolver = resolverPayload;
    envelope.lt = {
      ...envelope.lt,
      escalationId: escalation.id,
    };

    // 4. Start a new workflow to re-run with resolver data
    const newWorkflowId = `rerun-${escalation.id}-${Date.now()}`;
    const client = createClient();

    await client.workflow.start({
      workflowName: escalation.workflow_type!,
      args: [envelope],
      taskQueue: escalation.task_queue!,
      workflowId: newWorkflowId,
      expire: 180,
    });

    res.json({ started: true, escalationId: escalation.id, workflowId: newWorkflowId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
