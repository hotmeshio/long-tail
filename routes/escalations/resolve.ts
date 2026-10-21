import { Router } from '../../lib/http';

import * as api from '../../api/escalations';
import { ACTING_TOKEN_HEADER, effectiveWorkAuth } from './acting';

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
   * POST /api/escalations/resolve-batch-item-by-signal-key
   * Submit ONE declared item of a batch escalation by its signal_key — the
   * deterministic home signal id the waiting workflow parked on. For callers
   * that already own that identity (a child calling home, a webhook).
   * Literal single-segment path — registered before /:id routes.
   * Body: { signalKey: string, itemKey: string, resolverPayload: Record<string, any>,
   *         metadata?: Record<string, any> }
   */
  router.post('/resolve-batch-item-by-signal-key', async (req, res) => {
    const result = await api.resolveBatchItemBySignalKey(
      {
        signalKey: req.body?.signalKey,
        itemKey: req.body?.itemKey,
        resolverPayload: req.body?.resolverPayload,
        metadata: req.body?.metadata,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/resolve-batch-item
   * Submit ONE declared item of a batch escalation. Interim items return
   * { outcome: 'accepted', remaining }; the LAST item completes the
   * escalation and wakes the waiting workflow with the full collection.
   * Claim-agnostic by default; assertClaim: true requires the caller's own
   * live claim, asserted atomically.
   * Body: { itemKey: string, resolverPayload: Record<string, any>,
   *         metadata?: Record<string, any>, assertClaim?: boolean }
   */
  router.post('/:id/resolve-batch-item', async (req, res) => {
    const auth = await effectiveWorkAuth(req, res);
    if (!auth) return;
    const result = await api.resolveBatchItem(
      {
        id: req.params.id,
        itemKey: req.body?.itemKey,
        resolverPayload: req.body?.resolverPayload,
        metadata: req.body?.metadata,
        assertClaim: req.body?.assertClaim,
      },
      auth,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/flag-batch-item
   * Flag ONE pending key of a batch escalation (e.g. `Missing`). The key stays
   * pending and still fills; a wait declared with `wakeOnFlag` ends on the flag.
   * Body: { itemKey: string, label: string, payload?: Record<string, any> }
   */
  router.post('/:id/flag-batch-item', async (req, res) => {
    const auth = await effectiveWorkAuth(req, res);
    if (!auth) return;
    const result = await api.flagBatchItem(
      { id: req.params.id, itemKey: req.body?.itemKey, label: req.body?.label, payload: req.body?.payload },
      auth,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/unflag-batch-item
   * Clear ONE key's flag while the batch escalation is pending.
   * Body: { itemKey: string }
   */
  router.post('/:id/unflag-batch-item', async (req, res) => {
    const auth = await effectiveWorkAuth(req, res);
    if (!auth) return;
    const result = await api.unflagBatchItem({ id: req.params.id, itemKey: req.body?.itemKey }, auth);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/roster-action
   * Run one action a roster entry offers on this row's form. The server
   * re-reads the action from the row's form schema, checks the entry and any
   * role limit, and runs the act as the person acting: the badged person when
   * X-LT-Acting-Token rides the request (spent only when the act runs).
   * Body: { field: string, action: number, entry: string, code?: string }
   */
  router.post('/:id/roster-action', async (req, res) => {
    const token = req.headers[ACTING_TOKEN_HEADER];
    const result = await api.runRosterAction(
      {
        id: req.params.id,
        field: req.body?.field,
        action: req.body?.action,
        entry: req.body?.entry,
        code: req.body?.code,
        actingToken: typeof token === 'string' && token ? token : undefined,
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
    // The actor is the token user — or the badged person when an
    // X-LT-Acting-Token grant rides the request (station continuity: the
    // person who claimed by badge submits by badge).
    const auth = await effectiveWorkAuth(req, res);
    if (!auth) return;
    const result = await api.resolveEscalation(
      { id: req.params.id, resolverPayload: req.body?.resolverPayload, metadata: req.body?.metadata },
      auth,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
