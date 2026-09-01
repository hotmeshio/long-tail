/**
 * Batch Signal Workflow — one escalation accumulates N item submissions and
 * resolves only when the last declared item lands.
 *
 * `conditional(signalId, { batch: [...] })` writes ONE escalation row inside
 * the workflow's Leg1 checkpoint declaring the expected item keys. Each
 * contributor submits their item via POST /:id/resolve-batch-item (or
 * /resolve-batch-item-by-metadata) using the role's standard versioned form;
 * interim submissions are cheap atomic fills (`accepted`, remaining count),
 * and the LAST item resolves the row and resumes this workflow with the full
 * collection — accumulation at the escalation boundary, without waking the
 * workflow per item.
 */

import { conditional } from '../../../services/orchestrator/condition';

import type { LTEnvelope } from '../../../types';

const BATCH_STATIONS = ['cut', 'weld', 'paint'] as const;

type StationResult = { ok: boolean; notes?: string };
type StationCollection = Record<(typeof BATCH_STATIONS)[number], StationResult>;

export async function batchSignal(envelope: LTEnvelope): Promise<any> {
  const {
    message = 'Each station submits its result; the order proceeds when all three are in.',
    role = 'reviewer',
    orderId = 'order-unspecified',
  } = envelope.data ?? {};

  const signalId = `batch-${orderId}`;

  const parts = await conditional<StationCollection>(signalId, {
    role,
    type: 'batch-signal',
    subtype: 'accumulator',
    description: message,
    priority: 2,
    workflowType: 'batchSignal',
    metadata: { orderId },
    envelope: { data: envelope.data },
    batch: [...BATCH_STATIONS],
    timeout: '24h',
  });

  if (parts === false) {
    return { type: 'return' as const, data: { completed: false, reason: 'sla-expired' } };
  }
  if (parts === null) {
    return { type: 'return' as const, data: { completed: false, reason: 'cancelled' } };
  }

  return {
    type: 'return' as const,
    data: {
      completed: true,
      stations: parts,
      allOk: BATCH_STATIONS.every((s) => parts[s]?.ok === true),
    },
  };
}
