import type { Router } from 'express';

import * as api from '../../api/escalations';
import { effectiveWorkAuth } from './acting';

/**
 * Open-accumulator routes. The literal single-segment paths are registered
 * before the parameterized routes so /:id never shadows them; the /:id/*
 * forms run as the effective work actor (badge continuity at a station).
 */
export function registerAccumulateRoutes(router: Router): void {
  /**
   * POST /api/escalations/accumulate-by-signal-key
   * Add one item to an accumulator escalation by its signal_key.
   * Body: { signalKey, itemKey, payload?, metadata?, reciprocal? }
   */
  router.post('/accumulate-by-signal-key', async (req, res) => {
    const result = await api.accumulateItemBySignalKey({
      signalKey: req.body?.signalKey,
      itemKey: req.body?.itemKey,
      payload: req.body?.payload,
      metadata: req.body?.metadata,
      reciprocal: req.body?.reciprocal,
    }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/accumulate-by-metadata
   * Add one item to the highest priority pending accumulator whose metadata
   * contains the key/value.
   * Body: { key, value, itemKey, payload?, metadata?, restrictRoles?, reciprocal? }
   */
  router.post('/accumulate-by-metadata', async (req, res) => {
    const result = await api.accumulateItemByMetadata({
      key: req.body?.key,
      value: req.body?.value,
      itemKey: req.body?.itemKey,
      payload: req.body?.payload,
      metadata: req.body?.metadata,
      restrictRoles: req.body?.restrictRoles,
      reciprocal: req.body?.reciprocal,
    }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/remove-item-by-signal-key
   * Body: { signalKey, itemKey, reciprocal? }
   */
  router.post('/remove-item-by-signal-key', async (req, res) => {
    const result = await api.removeItemBySignalKey({
      signalKey: req.body?.signalKey,
      itemKey: req.body?.itemKey,
      reciprocal: req.body?.reciprocal,
    }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/remove-item-by-metadata
   * Body: { key, value, itemKey, restrictRoles?, reciprocal? }
   */
  router.post('/remove-item-by-metadata', async (req, res) => {
    const result = await api.removeItemByMetadata({
      key: req.body?.key,
      value: req.body?.value,
      itemKey: req.body?.itemKey,
      restrictRoles: req.body?.restrictRoles,
      reciprocal: req.body?.reciprocal,
    }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/accumulate
   * Add one item. Interim adds answer { outcome: 'accepted', count, remaining };
   * the add that reaches max answers { outcome: 'completed', signaled } and the
   * waiting workflow resumes with the collection. Claim-agnostic unless
   * assertClaim: true.
   * Body: { itemKey, payload?, metadata?, assertClaim?, reciprocal? }
   */
  router.post('/:id/accumulate', async (req, res) => {
    const auth = await effectiveWorkAuth(req, res);
    if (!auth) return;
    const result = await api.accumulateItem({
      id: req.params.id,
      itemKey: req.body?.itemKey,
      payload: req.body?.payload,
      metadata: req.body?.metadata,
      assertClaim: req.body?.assertClaim,
      reciprocal: req.body?.reciprocal,
    }, auth);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * POST /api/escalations/:id/remove-item
   * Remove one held item; the row stays pending and the waiter never wakes.
   * Body: { itemKey, reciprocal? }
   */
  router.post('/:id/remove-item', async (req, res) => {
    const auth = await effectiveWorkAuth(req, res);
    if (!auth) return;
    const result = await api.removeItem({
      id: req.params.id,
      itemKey: req.body?.itemKey,
      reciprocal: req.body?.reciprocal,
    }, auth);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/:id/items
   * The held items of an accumulator or batch row in arrival order.
   */
  router.get('/:id/items', async (req, res) => {
    const result = await api.getEscalationItems({ id: req.params.id }, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
