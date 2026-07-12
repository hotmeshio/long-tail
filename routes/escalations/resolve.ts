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
   * POST /api/escalations/resolve-by-ids
   * Resolve a SET of escalations by id in one guarded statement (set-based sibling of
   * /:id/resolve). RBAC: scoped callers may only resolve rows whose role they hold.
   * Body: { ids: string[], resolverPayload: Record<string, any>, metadata?: Record<string, any> }
   */
  router.post('/resolve-by-ids', async (req, res) => {
    const result = await api.resolveByIds(
      {
        ids: req.body?.ids,
        resolverPayload: req.body?.resolverPayload,
        metadata: req.body?.metadata,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/resolve-all-or-none
   * Atomic bulk resolve with per-row payloads: every listed escalation resolves
   * with its own resolverPayload in one statement, or nothing resolves. Rows
   * backing a live condition() waiter are woken with their own payload (same
   * wake contract as /:id/resolve). 409 returns { error, failedIds, failed }
   * naming exactly the rows that blocked the batch. Max 100 items per call.
   * Body: { items: Array<{ id: string, resolverPayload: Record<string, any> }>,
   *         metadata?: Record<string, any>, requireClaimed?: boolean }
   */
  router.post('/resolve-all-or-none', async (req, res) => {
    const result = await api.resolveAllOrNone(
      {
        items: req.body?.items,
        metadata: req.body?.metadata,
        requireClaimed: req.body?.requireClaimed,
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
