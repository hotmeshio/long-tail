import { Router } from 'express';

import * as api from '../../api/escalations';

/**
 * Faceted-routing HTTP surface — pond search + batch claim. Each operation targets a
 * single pond `role` and is RBAC-scoped to it (the api layer enforces the gate). These
 * mirror the SDK `escalations.searchByFacets / claimGroups / claimByFacets`.
 */
export function registerFacetRoutes(router: Router): void {
  /**
   * POST /api/escalations/search-by-facets
   * Item-level faceted search over a pond, scoped to the caller's role.
   * Body: FacetQuery — { role, status?, available?, facets?, orderBy?, limit?, offset? }
   */
  router.post('/search-by-facets', async (req, res) => {
    const result = await api.searchByFacets(req.body ?? {}, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/claim-groups
   * Batch-claim complete origin groups in priority order, assigned to the caller.
   * Body: { query: FacetQuery, limit?, durationMinutes?, sizeFacet? }
   */
  router.post('/claim-groups', async (req, res) => {
    const result = await api.claimGroups(
      {
        query: req.body?.query,
        limit: req.body?.limit,
        durationMinutes: req.body?.durationMinutes,
        sizeFacet: req.body?.sizeFacet,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/claim-by-facets
   * Batch-claim individual rows (FOR UPDATE SKIP LOCKED), assigned to the caller.
   * Body: { query: FacetQuery, limit?, durationMinutes?, allOrNone? }
   */
  router.post('/claim-by-facets', async (req, res) => {
    const result = await api.claimByFacets(
      {
        query: req.body?.query,
        limit: req.body?.limit,
        durationMinutes: req.body?.durationMinutes,
        allOrNone: req.body?.allOrNone,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
