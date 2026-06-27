/**
 * printBroker — the market maker. A looping durable singleton (run several per fleet
 * for throughput; carry-forward keeps them disjoint). Each tick: place the carried
 * backlog, claim fresh demand by priority sized to free capacity, batch-lock the
 * printers and hand off, then harvest every printer's completion in parallel and
 * settle. The broker is the durable coordinator; the saga is crash-safe-forward.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';

import { claimOrdersForCapacity, lockPrintersAndHandoff, settleOrder, LOOP_DEFAULTS } from './proxy';
import type {
  BrokerData,
  BrokerTotals,
  BrokerPairing,
  ClaimedOrderBucket,
  PrintCallbackPayload,
} from '../types';

export async function printBroker(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as BrokerData;
  const ctx = Durable.workflow.workflowInfo();
  const cumulative: BrokerTotals = d.cumulative ?? { ordersPrinted: 0, runs: 0 };
  const tick = cumulative.runs; // deterministic per-tick counter — callback-key uniqueness
  const carried: ClaimedOrderBucket[] = d.carried ?? [];

  const pairings: BrokerPairing[] = [];
  const unplaced: ClaimedOrderBucket[] = [];

  // 1. Place the carried backlog first — already claimed and aging, so it has
  //    priority over fresh demand. Whatever still finds no printer is carried on.
  if (carried.length) {
    const r = await lockPrintersAndHandoff({
      diabetic: d.diabetic, brokerId: d.brokerId, brokerWorkflowId: ctx.workflowId,
      tick, phase: 'c', claimMinutes: d.claimMinutes, buckets: carried,
    });
    pairings.push(...r.pairings);
    unplaced.push(...r.unplaced);
  }

  // 2. Claim fresh demand only once the backlog is placed — when printers are
  //    scarce, holding the backlog beats piling on claims we cannot put to work.
  if (unplaced.length === 0) {
    const fresh = await claimOrdersForCapacity({
      diabetic: d.diabetic, brokerId: d.brokerId,
      priorityRules: d.priorityRules, claimMinutes: d.claimMinutes, maxAdverts: d.maxAdverts,
    });
    if (fresh.matched > 0) {
      const r = await lockPrintersAndHandoff({
        diabetic: d.diabetic, brokerId: d.brokerId, brokerWorkflowId: ctx.workflowId,
        tick, phase: 'f', claimMinutes: d.claimMinutes, buckets: fresh.buckets,
      });
      pairings.push(...r.pairings);
      unplaced.push(...r.unplaced);
    }
  }

  // 3. Harvest. Every job was dispatched up front, so the fleet prints concurrently;
  //    awaiting the callbacks in turn collects them in ~max(print-time), not the sum
  //    (a callback that arrives while we wait on an earlier one is stored and ready).
  //    Concurrent `condition()` waits are NOT safe here — they race the durable wait
  //    registration and deadlock — so the harvest is a serial loop.
  for (const p of pairings) {
    const done = (await Durable.workflow.condition<PrintCallbackPayload>(p.callbackKey)) as PrintCallbackPayload;
    await settleOrder({ group: p.group, printerId: p.printerId, done });
  }

  cumulative.ordersPrinted += pairings.length;
  cumulative.runs += 1;

  // The broker is working whenever it printed or is still carrying a backlog.
  const working = pairings.length > 0 || unplaced.length > 0;
  const maxIdleRuns = d.maxIdleRuns ?? LOOP_DEFAULTS.maxIdleRuns;
  const idleRuns = working ? 0 : (d.idleRuns ?? 0) + 1;
  if (idleRuns >= maxIdleRuns) {
    return { type: 'return' as const, data: { ...cumulative, stopped: 'idle' } };
  }

  const tickSecs = working
    ? (d.tickSeconds ?? LOOP_DEFAULTS.tickSeconds)
    : (d.idleTickSeconds ?? LOOP_DEFAULTS.idleTickSeconds);
  await Durable.workflow.sleep(`${tickSecs} seconds`);

  const nextEnvelope: LTEnvelope = {
    data: { ...d, cumulative, idleRuns, carried: unplaced },
    metadata: envelope.metadata ?? {},
  };
  await Durable.workflow.continueAsNew(nextEnvelope);
}
