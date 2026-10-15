/**
 * Consolidation: orders converge on a container per destination.
 *
 * `consolidationOrder` walks one order through two stations (prep, then
 * check), each a plain `conditional` wait carrying the order's facets
 * (`orderId`, `destination`, `serviceLevel`). It then parks as a member in
 * the stage role: an accumulator of one that completes the moment the order
 * is placed in a container with a reciprocal add.
 *
 * `consolidationBin` is the container: an open accumulator keyed by `binKey`
 * and carrying the `destination` it ships to. A tub split into lanes (one
 * per service level, say) is one bin per lane sharing the `binKey`. It
 * resolves when it is full, when its window closes, or by hand.
 *
 * The container role's list schema reads both sides without a bespoke
 * service: what each bin holds, split by the members' service level, and
 * what is still coming toward it from the stations, by station.
 */

import { conditional, conditionalAccumulator } from '../../../services/orchestrator/condition';

import type { LTEnvelope } from '../../../types';

export const CONSOLIDATION_ROLES = {
  PREP: 'order-prep',
  CHECK: 'order-check',
  STAGE: 'order-stage',
  BIN: 'consolidate',
} as const;

/** The stations an order passes before it is staged, in order. */
export const CONSOLIDATION_STATIONS = [CONSOLIDATION_ROLES.PREP, CONSOLIDATION_ROLES.CHECK] as const;

export const SERVICE_LEVELS = {
  STANDARD: 'standard',
  EXPRESS: 'express',
} as const;

export type PlacedPayload = { weight?: number };

export async function consolidationOrder(envelope: LTEnvelope): Promise<any> {
  const {
    orderId = 'order-unspecified',
    destination = 'destination-unspecified',
    serviceLevel = SERVICE_LEVELS.STANDARD,
  } = envelope.data ?? {};
  const facets = { orderId, destination, serviceLevel };

  // 1. Each station is one wait; its row carries the order's facets.
  for (const role of CONSOLIDATION_STATIONS) {
    const done = await conditional<{ ok?: boolean }>(`${role}-${orderId}`, {
      role,
      type: 'consolidation',
      subtype: role,
      description: `Order ${orderId} for ${destination}`,
      priority: serviceLevel === SERVICE_LEVELS.EXPRESS ? 1 : 3,
      workflowType: 'consolidationOrder',
      metadata: facets,
      envelope: { data: envelope.data },
    });
    if (done === null || done === false) {
      return { type: 'return' as const, data: { orderId, placed: false, stoppedAt: role } };
    }
  }

  // 2. Staged: placing the order in a container completes this row.
  const placement = await conditionalAccumulator<PlacedPayload>(`stage-${orderId}`, {
    role: CONSOLIDATION_ROLES.STAGE,
    type: 'consolidation',
    subtype: 'staged',
    description: `Order ${orderId} ready for ${destination}`,
    priority: serviceLevel === SERVICE_LEVELS.EXPRESS ? 1 : 3,
    workflowType: 'consolidationOrder',
    metadata: facets,
    envelope: { data: envelope.data },
    accumulate: { max: 1 },
    timeout: '24h',
  });
  const bin = placement?.$accumulated[0];
  return {
    type: 'return' as const,
    data: { orderId, placed: !!bin, binEscalationId: bin?.itemKey ?? null, placedAt: bin?.at ?? null },
  };
}

export async function consolidationBin(envelope: LTEnvelope): Promise<any> {
  const {
    binKey = 'bin-unspecified',
    destination = 'destination-unspecified',
    lane,
    max = 12,
    timeout = '8h',
  } = envelope.data ?? {};

  const signalId = lane ? `consolidate-${binKey}-${lane}` : `consolidate-${binKey}`;
  const bin = await conditionalAccumulator<PlacedPayload, { shippedBy?: string }>(signalId, {
    role: CONSOLIDATION_ROLES.BIN,
    type: 'consolidation',
    subtype: 'bin',
    description: `Bin ${binKey}${lane ? ` (${lane})` : ''} for ${destination}`,
    priority: 2,
    workflowType: 'consolidationBin',
    metadata: { binKey, destination, ...(lane ? { lane } : {}) },
    envelope: { data: envelope.data },
    accumulate: { max },
    timeout,
  });
  if (bin === null) {
    return { type: 'return' as const, data: { binKey, shipped: false, reason: 'cancelled' } };
  }
  return {
    type: 'return' as const,
    data: {
      binKey,
      shipped: true,
      trigger: bin.$trigger,
      orders: bin.$accumulated.map((item) => item.itemKey),
    },
  };
}
