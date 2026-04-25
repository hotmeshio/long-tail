import { Router } from 'express';

import * as api from '../../api/escalations';

export function registerSingleRoutes(router: Router): void {
  /**
   * PATCH /api/escalations/:id/escalate
   * Reassign an escalation to a different role.
   * Body: { targetRole: string }
   */
  router.patch('/:id/escalate', async (req, res) => {
    const result = await api.escalateToRole(
      { id: req.params.id, targetRole: req.body?.targetRole },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/by-workflow/:workflowId
   * List escalations linked to a specific workflow.
   */
  router.get('/by-workflow/:workflowId', async (req, res) => {
    const result = await api.getEscalationsByWorkflowId({
      workflowId: req.params.workflowId,
    });
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  // -- Parameterized routes (must come after literal paths) --

  /**
   * GET /api/escalations/:id
   * Get a single escalation by ID.
   * RBAC: superadmin sees all; others must hold the escalation's role.
   */
  router.get('/:id', async (req, res) => {
    const result = await api.getEscalation(
      { id: req.params.id },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/claim
   * Claim an escalation. userId comes from auth token.
   * Body: { durationMinutes?: number }
   */
  router.post('/:id/claim', async (req, res) => {
    const result = await api.claimEscalation(
      { id: req.params.id, durationMinutes: req.body?.durationMinutes },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/release
   * Release a claimed escalation back to the available pool.
   * Only the assigned user may release their own claim.
   */
  router.post('/:id/release', async (req, res) => {
    const result = await api.releaseEscalation(
      { id: req.params.id },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
