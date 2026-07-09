/**
 * Twin-side activity — report the print outcome to the broker by RESOLVING the
 * broker's `dispatched` row (`signal_key = callbackKey`). One atomic call marks
 * the row resolved, delivers the wake to the broker's collated wait, and merges
 * the outcome facets into the GIN-indexed metadata — together or not at all.
 *
 * The broker opens that row right after the handoff, but the mock physical side
 * can finish fast — retry until the row exists (the same signal-delivery grace
 * the print-routing printers use, ~30s).
 */

import { createClient } from '../../../../sdk';

import { OUTCOME_FACETS } from '../types';
import type { PrintOutcome, TwinCallbackPayload } from '../types';

export async function reportPrintOutcome(input: {
  callbackKey: string;
  outcome: PrintOutcome;
  printerId: string;
  jobId: string;
  orderId: string;
  unitIndex: number;
  /** Twin operator — a principal holding the fleet pond role (the broker's
   *  dispatched row carries role = fleet pond). */
  operatorId: string;
}): Promise<TwinCallbackPayload> {
  const lt = createClient({ auth: { userId: input.operatorId } });

  const payload: TwinCallbackPayload = {
    outcome: input.outcome,
    printerId: input.printerId,
    jobId: input.jobId,
    orderId: input.orderId,
    unitIndex: input.unitIndex,
    completedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 60; attempt++) {
    const res = await lt.escalations.resolveBySignalKey({
      signalKey: input.callbackKey,
      resolverPayload: payload,
      metadata: { [OUTCOME_FACETS.OUTCOME]: input.outcome, [OUTCOME_FACETS.JOB_ID]: input.jobId },
    });
    if (res.status === 200) return payload;
    if (res.status !== 404) throw new Error(`broker callback resolve failed (${res.status}): ${res.error ?? ''}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dispatched row ${input.callbackKey} never opened`);
}
