import { Router } from 'express';

import * as escalationService from '../../services/escalation';
import { getVisibleRoles } from './helpers';

export function registerListRoutes(router: Router): void {
  /**
   * GET /api/escalations
   * List escalations with optional filters.
   * RBAC: superadmin sees all; others see only roles they belong to.
   */
  router.get('/', async (req, res) => {
    try {
      const userId = req.auth!.userId;
      const visibleRoles = await getVisibleRoles(userId);
      if (visibleRoles && visibleRoles.length === 0) {
        res.json({ escalations: [], total: 0 });
        return;
      }

      const result = await escalationService.listEscalations({
        status: req.query.status as any,
        role: req.query.role as string,
        type: req.query.type as string,
        subtype: req.query.subtype as string,
        assigned_to: req.query.assigned_to as string,
        priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        sort_by: req.query.sort_by as string,
        order: req.query.order as string,
        visibleRoles,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/escalations/available
   * List available escalations (pending, unassigned or expired claim).
   * RBAC: superadmin sees all; others see only roles they belong to.
   */
  router.get('/available', async (req, res) => {
    try {
      const userId = req.auth!.userId;
      const visibleRoles = await getVisibleRoles(userId);
      if (visibleRoles && visibleRoles.length === 0) {
        res.json({ escalations: [], total: 0 });
        return;
      }

      const result = await escalationService.listAvailableEscalations({
        role: req.query.role as string,
        type: req.query.type as string,
        subtype: req.query.subtype as string,
        priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        sort_by: req.query.sort_by as string,
        order: req.query.order as string,
        visibleRoles,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/escalations/types
   * Returns distinct escalation type values.
   */
  router.get('/types', async (_req, res) => {
    try {
      const types = await escalationService.listDistinctTypes();
      res.json({ types });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/escalations/stats
   * Aggregated escalation statistics.
   * RBAC: superadmin sees all; others scoped to their roles.
   */
  router.get('/stats', async (req, res) => {
    try {
      const userId = req.auth!.userId;
      const visibleRoles = await getVisibleRoles(userId);
      if (visibleRoles && visibleRoles.length === 0) {
        res.json({
          pending: 0, claimed: 0,
          created: 0, resolved: 0,
          by_role: [], by_type: [],
        });
        return;
      }
      const period = (req.query.period as string) || undefined;
      const stats = await escalationService.getEscalationStats(visibleRoles, period);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
