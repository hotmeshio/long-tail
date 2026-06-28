/**
 * Printer-side activity — the printer's "print": run the job, then report completion
 * by RESOLVING the broker's callback escalation (`signal_key = callbackKey`). The
 * escalation is the boundary where the physical outcome re-enters the digital twin:
 * resolving double-fires `wfs.signal` + `wfs.wait`, which is what resumes the broker's
 * *collated* wait (a raw signal would not). The broker opens that row right after the
 * handoff wakes us, so retry briefly until it exists before resolving it.
 *
 * Resolving also MERGES an outcome patch into the row's GIN-indexed metadata.
 * The row was created carrying intent (printerId, state=printing);
 * we add what actually happened — outcome, units, and the boundary duration
 * (`created_at` = handoff/print start → now = done). One row, the whole story,
 * `@>`-queryable. The escalation trail alone answers "what ran, on which machine,
 * how long it took."
 */

import * as escalationService from '../../../../services/escalation';

import { OUTCOME_FACETS } from '../types';
import type { PrinterJobPayload, PrintCallbackPayload, PrintOutcomeFacets } from '../types';

export async function runPrintJob(input: {
  job: PrinterJobPayload;
  printerId: string;
}): Promise<void> {
  const { job, printerId } = input;

  for (let attempt = 0; attempt < 25; attempt++) {
    // The broker opens the `printing` row right after waking us; wait for it.
    const row = await escalationService.getEscalationBySignalKey(job.callbackKey);
    if (!row) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const completedAt = new Date();
    // Boundary duration: the row's created_at is the handoff (print start); now is done.
    const durationMs = Math.max(0, completedAt.getTime() - new Date(row.created_at).getTime());

    const payload: PrintCallbackPayload = {
      result: 'success',
      printerId,
      orderId: job.orderId,
      units: job.units,
      completedAt: completedAt.toISOString(),
    };
    const outcome: PrintOutcomeFacets = {
      [OUTCOME_FACETS.OUTCOME]: 'success',
      [OUTCOME_FACETS.DURATION_MS]: durationMs,
      [OUTCOME_FACETS.UNITS_PRINTED]: job.units,
      [OUTCOME_FACETS.COMPLETED_AT]: completedAt.toISOString(),
    };

    // Resolve the row by id (immutable signal_key → id): resume the broker AND
    // record the outcome onto the same row in one atomic UPDATE.
    const resolved = await escalationService.resolveEscalation(row.id, payload, outcome);
    if (resolved) return;

    // Lost the resolve race (already terminal) — nothing left to do.
    return;
  }
  throw new Error(`callback escalation ${job.callbackKey} never opened`);
}
