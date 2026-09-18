/**
 * Rollup Bin — an open accumulator at the escalation boundary.
 *
 * `conditionalAccumulator(signalId, { accumulate: { max } })` parks ONE
 * container escalation that fills over time: each scanned bag joins it via
 * POST /:id/accumulate (or the by-signal-key / by-metadata forms, or a scan
 * rule with the `accumulate` verb). The container resolves when `max` bags
 * are held, when its SLA timer fires, or when someone resolves it by hand,
 * and on every one of those paths the workflow receives the ordered
 * collection plus the trigger that ended the wait. A cancel yields null.
 *
 * `rollupMember` is the reciprocal side: a bag's own accumulator of one. A
 * reciprocal add writes the bag's row and the bin's row in ONE statement,
 * so "which bin holds this bag" and "which bags are in this bin" are both
 * row truth, each queryable through the `accumulate_keys` facet.
 */

import { conditionalAccumulator } from '../../../services/orchestrator/condition';

import type { LTEnvelope } from '../../../types';

export const ROLLUP_BIN_ROLE = 'bin';
export const ROLLUP_MEMBER_ROLE = 'bag';

export type BagPayload = { weight?: number; scannedBy?: string };

export async function rollupBin(envelope: LTEnvelope): Promise<any> {
  const {
    binKey = 'bin-unspecified',
    max = 4,
    timeout = '2h',
    role = ROLLUP_BIN_ROLE,
    message = 'Scan each bag into the bin; the bin ships when it is full or the window closes.',
  } = envelope.data ?? {};

  const signalId = `bin-${binKey}`;

  const bin = await conditionalAccumulator<BagPayload, { shippedBy?: string }>(signalId, {
    role,
    type: 'rollup',
    subtype: 'bin',
    description: message,
    priority: 2,
    workflowType: 'rollupBin',
    metadata: { binKey },
    envelope: { data: envelope.data },
    accumulate: { max },
    timeout,
  });

  if (bin === null) {
    return { type: 'return' as const, data: { shipped: false, reason: 'cancelled' } };
  }

  return {
    type: 'return' as const,
    data: {
      shipped: true,
      trigger: bin.$trigger,
      bags: bin.$accumulated.map((item) => item.itemKey),
      totalWeight: bin.$accumulated.reduce((sum, item) => sum + (item.payload?.weight ?? 0), 0),
      ...(bin.shippedBy ? { shippedBy: bin.shippedBy } : {}),
    },
  };
}

export async function rollupMember(envelope: LTEnvelope): Promise<any> {
  const {
    orderId = 'order-unspecified',
    binKey,
    role = ROLLUP_MEMBER_ROLE,
    message = 'Waiting to be scanned into a bin.',
  } = envelope.data ?? {};

  const signalId = `bag-${orderId}`;

  const placement = await conditionalAccumulator<Record<string, unknown>>(signalId, {
    role,
    type: 'rollup',
    subtype: 'bag',
    description: message,
    priority: 3,
    workflowType: 'rollupMember',
    metadata: { orderId, ...(binKey ? { binKey } : {}) },
    envelope: { data: envelope.data },
    accumulate: { max: 1 },
    timeout: '24h',
  });

  if (placement === null) {
    return { type: 'return' as const, data: { placed: false, reason: 'cancelled' } };
  }
  const bin = placement.$accumulated[0];
  return {
    type: 'return' as const,
    data: {
      placed: !!bin,
      trigger: placement.$trigger,
      binEscalationId: bin?.itemKey ?? null,
      placedAt: bin?.at ?? null,
    },
  };
}
