import type { Router } from 'express';

import * as api from '../../api/escalations';

/**
 * Register metadata-based escalation lookup routes.
 * Must be registered BEFORE parameterized /:id routes.
 */
export function registerMetadataRoutes(router: Router): void {
  /**
   * GET /api/escalations/by-metadata
   * Find escalations by a metadata key-value pair.
   * Query: key, value, status?, limit?, offset?
   */
  router.get('/by-metadata', async (req, res) => {
    const result = await api.findByMetadata({
      key: req.query.key as string,
      value: req.query.value as string,
      status: req.query.status as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/claim-by-metadata
   * Find and claim an escalation by metadata key-value pair.
   * Body: { key, value, durationMinutes?, assignee? }
   */
  router.post('/claim-by-metadata', async (req, res) => {
    const result = await api.claimByMetadata({
      key: req.body?.key,
      value: req.body?.value,
      durationMinutes: req.body?.durationMinutes,
      assignee: req.body?.assignee,
    }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/resolve-by-metadata
   * Find and resolve an escalation by metadata key-value pair.
   * Body: { key, value, resolverPayload, assignee? }
   */
  router.post('/resolve-by-metadata', async (req, res) => {
    const result = await api.resolveByMetadata({
      key: req.body?.key,
      value: req.body?.value,
      resolverPayload: req.body?.resolverPayload,
      assignee: req.body?.assignee,
    }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
