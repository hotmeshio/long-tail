import { Router } from 'express';

import * as api from '../../api/escalations';

export function registerResolveRoutes(router: Router): void {
  /**
   * POST /api/escalations/:id/resolve
   * Start a new workflow with resolver data to re-run the failed step.
   * The interceptor in the new workflow resolves the escalation record
   * and signals back to the orchestrator (if any) on success.
   * Body: { resolverPayload: Record<string, any> }
   */
  router.post('/:id/resolve', async (req, res) => {
    const result = await api.resolveEscalation(
      { id: req.params.id, resolverPayload: req.body?.resolverPayload },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
