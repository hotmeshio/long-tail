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

import { createClient } from '../../../../sdk';

import { OUTCOME_FACETS } from '../types';
import type { PrinterJobPayload, PrintCallbackPayload, PrintOutcomeFacets } from '../types';

export async function runPrintJob(input: {
  job: PrinterJobPayload;
  printerId: string;
  /** Printer operator — a principal holding the printer pond role (resolves the
   *  broker's callback advert, which carries role = printerPond). */
  operatorId: string;
}): Promise<void> {
  const { job, printerId, operatorId } = input;

  // Run as the printer operator — a principal holding the printer pond role (the
  // broker's callback advert carries role = printer pond).
  const lt = createClient({ auth: { userId: operatorId } });

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
    // One guarded UPDATE through the public API: resume the broker AND record the
    // outcome on the same row. 404 = the broker's `printing` row isn't open yet (retry).
    const res = await lt.escalations.resolveBySignalKey({
      signalKey: job.callbackKey,
      resolverPayload: payload,
      metadata: outcome,
    });
    if (res.status === 200) return;
    if (res.status !== 404) throw new Error(`callback resolve failed (${res.status}): ${res.error ?? ''}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`callback escalation ${job.callbackKey} never opened`);
}
