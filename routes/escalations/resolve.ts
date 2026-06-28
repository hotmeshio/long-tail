import { Router } from 'express';

import * as api from '../../api/escalations';

export function registerResolveRoutes(router: Router): void {
  /**
   * POST /api/escalations/resolve-by-signal-key
   * Resolve an efficient (atomic) escalation by its signal_key and resume the
   * waiting workflow in place. For webhook callers that know the deterministic
   * signal id. Literal single-segment path — registered before /:id/resolve so
   * it is never shadowed by the parameterized route.
   * Body: { signalKey: string, resolverPayload: Record<string, any>, metadata?: Record<string, any> }
   */
  router.post('/resolve-by-signal-key', async (req, res) => {
    const result = await api.resolveBySignalKey(
      {
        signalKey: req.body?.signalKey,
        resolverPayload: req.body?.resolverPayload,
        metadata: req.body?.metadata,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/resolve
   * Resolve a pending escalation with a human-provided payload. Routes by
   * escalation shape: efficient (signal_key) resumes the job in place; legacy
   * paths signal via routing metadata or re-run the original workflow.
   * Body: { resolverPayload: Record<string, any>, metadata?: Record<string, any> }
   */
  router.post('/:id/resolve', async (req, res) => {
    const result = await api.resolveEscalation(
      { id: req.params.id, resolverPayload: req.body?.resolverPayload, metadata: req.body?.metadata },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
