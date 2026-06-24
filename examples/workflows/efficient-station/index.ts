/**
 * Efficient Station — the atomic-escalation pattern for a pipeline child
 * workflow, expressed through long-tail's `conditionLT`.
 *
 * This is the migration target for two-step station workers like
 * the reference app's `stationWorker` / `printJobWorker` / `signalAwaiter` and the
 * boilerplate's ortho `station`. Today those run:
 *
 *   await createStationEscalation({...});   // proxyActivity: create + enrich (2 writes)
 *   const resolution = await conditionLT(signalId);
 *
 * This collapses both into ONE atomic expression. The escalation row is
 * written inside the workflow's Leg1 checkpoint (crash-safe, one commit — no
 * create activity, no enrich), `signal_key` is the resume key, and the engine
 * fires `system.escalation.{id}.created` automatically. Resolution via the
 * dashboard (POST /escalations/:id/resolve, Path 0) or a webhook
 * (POST /escalations/resolve-by-signal-key) resumes THIS job in place.
 *
 * Sits beside the legacy station — never replaces it — so the two can be
 * compared on identical work.
 */

import { conditionLT } from '../../../services/orchestrator/condition';
import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';

export async function efficientStation(envelope: LTEnvelope): Promise<unknown> {
  const {
    stationName = 'station',
    role = 'operator',
    instructions = `Process the order at ${stationName}`,
    orderId,
  } = (envelope.data ?? {}) as {
    stationName?: string;
    role?: string;
    instructions?: string;
    orderId?: string;
  };

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `station-done-${ctx.workflowId}`;

  // One expression: atomic Leg1 escalation write + suspend.
  const resolution = await conditionLT<Record<string, unknown>>(signalId, {
    role,
    type: 'orderPipeline',
    subtype: stationName,
    priority: 2,
    description: instructions,
    workflowType: 'efficientStation',
    metadata: { station: stationName, ...(orderId ? { orderId } : {}) },
    envelope: { instructions, station: stationName },
  });

  if (!resolution) {
    return { type: 'return' as const, data: { stationName, cancelled: true } };
  }

  return {
    type: 'return' as const,
    data: {
      stationName,
      resolution,
      completedAt: new Date().toISOString(),
    },
  };
}
