import type { Router } from 'express';

import * as api from '../../api/escalations';

/**
 * Escalation analytics HTTP surface — grouped membership/dwell aggregates and
 * per-entity timelines over the interval time-series. Read-only; the api layer
 * enforces the read_all-per-role / global-for-cross-role gate. These mirror
 * the SDK `escalations.aggregateByFacets / timelineByFacet`.
 */
export function registerAnalyticsRoutes(router: Router): void {
  /**
   * POST /api/escalations/aggregate-by-facets
   * Body: AggregateByFacetsInput — { query, groupBy, measure, distinctBy?,
   *       states?, liveStatuses?, orderBy?, limit?, offset? }
   */
  router.post('/aggregate-by-facets', async (req, res) => {
    const result = await api.aggregateByFacets(req.body ?? {}, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/timeline-by-facet
   * Body: TimelineByFacetInput — { facet, query?, window?, select?,
   *       liveStatuses?, limit? }
   */
  router.post('/timeline-by-facet', async (req, res) => {
    const result = await api.timelineByFacet(req.body ?? {}, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
