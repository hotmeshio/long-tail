import type { Router } from 'express';

import * as api from '../../api/escalations';

/**
 * Related sets for role list views. The role's stored list schema declares
 * the sets; the caller names the role, the page's host rows, and the schema
 * version it rendered. Results are scoped to the caller's read scope.
 */
export function registerRelatedRoutes(router: Router): void {
  /**
   * POST /api/escalations/related
   * Body: { role, ids, version? }
   */
  router.post('/related', async (req, res) => {
    const result = await api.getRelatedAggregates(req.body ?? {}, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/related/rows
   * Body: { role, id, set, version?, limit? }
   */
  router.post('/related/rows', async (req, res) => {
    const result = await api.getRelatedRows(req.body ?? {}, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
