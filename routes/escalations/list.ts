import { Router } from 'express';

import * as api from '../../api/escalations';

export function registerListRoutes(router: Router): void {
  /**
   * GET /api/escalations
   * List escalations with optional filters.
   * RBAC: superadmin sees all; others see only roles they belong to.
   */
  router.get('/', async (req, res) => {
    const result = await api.listEscalations(
      {
        status: req.query.status as string,
        role: req.query.role as string,
        type: req.query.type as string,
        subtype: req.query.subtype as string,
        assigned_to: req.query.assigned_to as string,
        priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        sort_by: req.query.sort_by as string,
        order: req.query.order as string,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/available
   * List available escalations (pending, unassigned or expired claim).
   * RBAC: superadmin sees all; others see only roles they belong to.
   */
  router.get('/available', async (req, res) => {
    const result = await api.listAvailableEscalations(
      {
        role: req.query.role as string,
        type: req.query.type as string,
        subtype: req.query.subtype as string,
        priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        sort_by: req.query.sort_by as string,
        order: req.query.order as string,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/types
   * Returns distinct escalation type values.
   */
  router.get('/types', async (_req, res) => {
    const result = await api.listDistinctTypes();
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/stats
   * Aggregated escalation statistics.
   * RBAC: superadmin sees all; others scoped to their roles.
   */
  router.get('/stats', async (req, res) => {
    const result = await api.getEscalationStats(
      { period: (req.query.period as string) || undefined },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
