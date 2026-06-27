/**
 * farmTechnician — resolves printer needs-filament adverts ("added filament"). A
 * looping singleton (run several per fleet for throughput; resolution is idempotent
 * by query). The human stand-in; in production a dashboard operator claims these.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';

import { technicianRefill, LOOP_DEFAULTS } from './proxy';
import type { TechnicianData } from '../types';

export async function farmTechnician(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as TechnicianData;
  const refillsDone = d.cumulative ?? 0;

  const result = await technicianRefill({ diabetic: d.diabetic, technicianId: d.technicianId });
  const total = refillsDone + result.refilled;

  const maxIdleRuns = d.maxIdleRuns ?? LOOP_DEFAULTS.maxIdleRuns;
  const idleRuns = result.refilled > 0 ? 0 : (d.idleRuns ?? 0) + 1;
  if (idleRuns >= maxIdleRuns) {
    return { type: 'return' as const, data: { refills: total, stopped: 'idle' } };
  }

  const tick = result.refilled > 0
    ? (d.tickSeconds ?? LOOP_DEFAULTS.tickSeconds)
    : (d.idleTickSeconds ?? LOOP_DEFAULTS.idleTickSeconds);
  await Durable.workflow.sleep(`${tick} seconds`);

  const nextEnvelope: LTEnvelope = { data: { ...d, cumulative: total, idleRuns }, metadata: envelope.metadata ?? {} };
  await Durable.workflow.continueAsNew(nextEnvelope);
}
