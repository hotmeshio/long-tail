import { Router } from 'express';

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import * as roleService from '../../services/role';
import { publishEscalationEvent } from '../../lib/events/publish';

export function registerSingleRoutes(router: Router): void {
  /**
   * PATCH /api/escalations/:id/escalate
   * Reassign an escalation to a different role.
   * Body: { targetRole: string }
   */
  router.patch('/:id/escalate', async (req, res) => {
    try {
      const userId = req.auth!.userId;
      const { targetRole } = req.body || {};

      if (!targetRole || typeof targetRole !== 'string') {
        res.status(400).json({ error: 'targetRole is required' });
        return;
      }

      const escalation = await escalationService.getEscalation(req.params.id);
      if (!escalation) {
        res.status(404).json({ error: 'Escalation not found' });
        return;
      }
      if (escalation.status !== 'pending') {
        res.status(409).json({ error: 'Escalation is not pending' });
        return;
      }

      // Authorization: user must be able to escalate from current role to target role
      const canEscalate = await roleService.canEscalateTo(userId, escalation.role, targetRole);
      if (!canEscalate) {
        res.status(403).json({ error: 'Not authorized to escalate to this role' });
        return;
      }

      const updated = await escalationService.escalateToRole(req.params.id, targetRole);
      if (!updated) {
        res.status(409).json({ error: 'Escalation could not be updated' });
        return;
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/escalations/by-workflow/:workflowId
   * List escalations linked to a specific workflow.
   */
  router.get('/by-workflow/:workflowId', async (req, res) => {
    try {
      const escalations = await escalationService.getEscalationsByWorkflowId(
        req.params.workflowId,
      );
      res.json({ escalations });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- Parameterized routes (must come after literal paths) --

  /**
   * GET /api/escalations/:id
   * Get a single escalation by ID.
   * RBAC: superadmin sees all; others must hold the escalation's role.
   */
  router.get('/:id', async (req, res) => {
    try {
      const escalation = await escalationService.getEscalation(req.params.id);
      if (!escalation) {
        res.status(404).json({ error: 'Escalation not found' });
        return;
      }

      const userId = req.auth!.userId;
      const isSuperAdminUser = await userService.isSuperAdmin(userId);
      if (!isSuperAdminUser) {
        const userHasRole = await userService.hasRole(userId, escalation.role);
        if (!userHasRole) {
          res.status(403).json({ error: 'Not authorized to view this escalation' });
          return;
        }
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

      // Role check: user must hold the escalation's role or be superadmin
      const escalation = await escalationService.getEscalation(req.params.id);
      if (!escalation) {
        res.status(404).json({ error: 'Escalation not found' });
        return;
      }
      const isSuperAdminUser = await userService.isSuperAdmin(userId);
      if (!isSuperAdminUser) {
        const userHasRole = await userService.hasRole(userId, escalation.role);
        if (!userHasRole) {
          res.status(403).json({ error: `You must have the "${escalation.role}" role to claim this escalation` });
          return;
        }
      }

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

      publishEscalationEvent({
        type: 'escalation.claimed',
        source: 'api',
        workflowId: escalation.workflow_id || '',
        workflowName: escalation.workflow_type || '',
        taskQueue: escalation.task_queue || '',
        escalationId: req.params.id,
        status: 'claimed',
        data: { assigned_to: userId },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/escalations/:id/release
   * Release a claimed escalation back to the available pool.
   * Only the assigned user may release their own claim.
   */
  router.post('/:id/release', async (req, res) => {
    try {
      const userId = req.auth!.userId;
      const result = await escalationService.releaseEscalation(req.params.id, userId);

      if (!result) {
        res.status(409).json({ error: 'Escalation not found or not claimed by you' });
        return;
      }

      res.json({ escalation: result });

      publishEscalationEvent({
        type: 'escalation.released',
        source: 'api',
        workflowId: result.workflow_id || '',
        workflowName: result.workflow_type || '',
        taskQueue: result.task_queue || '',
        escalationId: req.params.id,
        status: 'released',
        data: { released_by: userId },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
