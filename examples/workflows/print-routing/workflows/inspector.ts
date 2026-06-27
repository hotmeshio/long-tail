/**
 * farmInspector — the farmer. Signs off completed orders: resolves each order-done
 * signoff escalation, which wakes the parked order (and triggers a reprint of any
 * rejected unit). A looping singleton (run several per fleet for throughput;
 * resolution is idempotent by query). The human stand-in; in production a dashboard
 * operator inspects and signs off.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';

import { inspectorSignoff, LOOP_DEFAULTS } from './proxy';
import type { InspectorData } from '../types';

export async function farmInspector(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as InspectorData;
  const signedOffSoFar = d.cumulative ?? 0;

  const result = await inspectorSignoff({ diabetic: d.diabetic, inspectorId: d.inspectorId });
  const total = signedOffSoFar + result.signedOff;

  const maxIdleRuns = d.maxIdleRuns ?? LOOP_DEFAULTS.maxIdleRuns;
  const idleRuns = result.signedOff > 0 ? 0 : (d.idleRuns ?? 0) + 1;
  if (idleRuns >= maxIdleRuns) {
    return { type: 'return' as const, data: { signoffs: total, stopped: 'idle' } };
  }

  const tick = result.signedOff > 0
    ? (d.tickSeconds ?? LOOP_DEFAULTS.tickSeconds)
    : (d.idleTickSeconds ?? LOOP_DEFAULTS.idleTickSeconds);
  await Durable.workflow.sleep(`${tick} seconds`);

  const nextEnvelope: LTEnvelope = { data: { ...d, cumulative: total, idleRuns }, metadata: envelope.metadata ?? {} };
  await Durable.workflow.continueAsNew(nextEnvelope);
}
