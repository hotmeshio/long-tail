/**
 * Printer-side activity — the printer's "print": run the job, then report completion
 * by RESOLVING the broker's callback escalation (`signal_key = callbackKey`). The
 * escalation is the boundary where the physical outcome re-enters the digital twin:
 * resolving double-fires `wfs.signal` + `wfs.wait`, which is what resumes the broker's
 * *collated* wait (a raw signal would not).
 *
 * One atomic call does it all (`resolveEscalationBySignalKey` → HotMesh `resolve`): the
 * status-guarded UPDATE marks the row resolved, delivers the signal, AND merges the
 * outcome patch into the GIN-indexed metadata — together or not at all. We never read
 * the row to compute anything: its own `created_at` (handoff) → `resolved_at` (done) IS
 * the print duration, derivable by query, so there is nothing to store or stitch.
 *
 * The broker opens that row right after the handoff wakes us, so the resolve may not find
 * it on the first try; retry briefly until it exists.
 */

import * as escalationService from '../../../../services/escalation';

import { OUTCOME_FACETS } from '../types';
import type { PrinterJobPayload, PrintCallbackPayload, PrintOutcomeFacets } from '../types';

export async function runPrintJob(input: {
  job: PrinterJobPayload;
  printerId: string;
}): Promise<void> {
  const { job, printerId } = input;

  const payload: PrintCallbackPayload = {
    result: 'success',
    printerId,
    orderId: job.orderId,
    units: job.units,
    completedAt: new Date().toISOString(),
  };
  const outcome: PrintOutcomeFacets = {
    [OUTCOME_FACETS.OUTCOME]: 'success',
    [OUTCOME_FACETS.UNITS_PRINTED]: job.units,
  };

  for (let attempt = 0; attempt < 25; attempt++) {
    // One guarded UPDATE: resume the broker AND record the outcome on the same row.
    const resolved = await escalationService.resolveEscalationBySignalKey(job.callbackKey, payload, outcome);
    if (resolved) return;
    await new Promise((r) => setTimeout(r, 200)); // the broker's `printing` row not open yet
  }
  throw new Error(`callback escalation ${job.callbackKey} never opened`);
}
