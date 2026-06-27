/**
 * Print Routing — an enterprise print farm where printers are durable workflows.
 *
 * Two ponds on one primitive, four actors:
 *
 *   printOrder      MAIN flow. Writes the order's insole escalations as one origin
 *                   group and parks until the farm prints them.
 *   printer         SUPPLY. One durable workflow per machine — `efficient-station`
 *                   in a loop. It advertises itself as an escalation, suspends, wakes
 *                   on the run outcome, and continueAsNew's. After every 3 runs it
 *                   advertises `needs-filament`; at 10 runs it retires (the workflow
 *                   completes — the asset's whole life is its escalation trail).
 *   printBroker     The market maker. Per fleet, it queries available printer adverts,
 *                   claims a printer and a matching order, prints, and resolves both.
 *   farmTechnician  The human stand-in. Resolves `needs-filament` adverts.
 *
 * Availability is a query, not a hash: a printer is free iff it holds a pending
 * `ready` advert. The escalation boundary is where the digital twin meets the
 * physical world.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { conditionLT } from '../../../services/orchestrator/condition';
import type { LTEnvelope } from '../../../types';

import * as activities from './activities';
import {
  roleForOrder,
  fleetKind,
  PRINTER_POND,
  FARMER_POND,
  PRINT_WORKFLOWS,
  PRINTER_FACETS,
  PRINTER_STATE,
  ORDER_SIGNOFF_TYPE,
  SIGNOFF_FACETS,
  PRINT_SOURCE,
  REFILL_INTERVAL,
  EOL_RUNS,
  MAX_PRINT_ATTEMPTS,
} from './types';
import type {
  PrintOrderData,
  PrintOrderResult,
  OrderDoneSignal,
  PrinterData,
  PrinterResult,
  PrinterJobPayload,
  PrintCallbackPayload,
  RefillPayload,
  BrokerData,
  BrokerTotals,
  BrokerPairing,
  ClaimedOrderBucket,
  SignoffPayload,
  TechnicianData,
  InspectorData,
} from './types';

const {
  enqueueOrderUnits,
  claimOrdersForCapacity,
  lockPrintersAndHandoff,
  settleOrder,
  runPrintJob,
  technicianRefill,
  inspectorSignoff,
} = Durable.workflow.proxyActivities<typeof activities>({
  activities,
  retry: { maximumAttempts: 3 },
});

const LOOP_DEFAULTS = { tickSeconds: 1, idleTickSeconds: 5, maxIdleRuns: 3 };

// ── printOrder: the enqueuer (main flow) ─────────────────────────────────────

export async function printOrder(envelope: LTEnvelope): Promise<any> {
  const order = envelope.data as PrintOrderData;
  const ctx = Durable.workflow.workflowInfo();
  const orderId = order.orderId ?? ctx.workflowId;
  const role = roleForOrder(order.diabetic);
  const farmerPond = FARMER_POND[fleetKind(order.diabetic)];

  // Reconcile to a finished order. Each pass prints the outstanding units, the
  // farmer inspects them, and whatever is rejected re-enters the *same* funnel as
  // a fresh deficit group — until intent ≡ actual. A route is a hypothesis; the
  // durable loop converges it. Only the order holds the original intent, so the
  // reconciliation lives here.
  let outstanding = order.units.map((_, i) => i);
  let attempt = 0;
  let last = { printerId: '', completedAt: '', inspectedBy: '' };

  while (outstanding.length > 0 && attempt < MAX_PRINT_ATTEMPTS) {
    const orderSignal = `order-done-${ctx.workflowId}-a${attempt}`;
    const originId = attempt === 0 ? orderId : `${orderId}#a${attempt}`;
    await enqueueOrderUnits({ order, originId, unitIndices: outstanding, role, orderSignal, workflowId: ctx.workflowId });

    const done = (await Durable.workflow.condition<OrderDoneSignal>(orderSignal)) as OrderDoneSignal;

    // The defect is transient: declared failures surface on the first print; a
    // reprint of the same unit succeeds. In production, reality decides.
    const failUnits = attempt === 0 ? (order.failUnits ?? []) : [];
    const signoff = (await conditionLT<SignoffPayload>(`signoff-${ctx.workflowId}-a${attempt}`, {
      role: farmerPond,
      type: ORDER_SIGNOFF_TYPE,
      subtype: done.printerId,
      priority: 2,
      description: `Order ${originId} printed on ${done.printerId} — inspect and sign off`,
      workflowType: PRINT_WORKFLOWS.ORDER,
      metadata: {
        [SIGNOFF_FACETS.ORDER_ID]: originId,
        [SIGNOFF_FACETS.PRINTER_ID]: done.printerId,
        [SIGNOFF_FACETS.UNITS]: done.units,
        [SIGNOFF_FACETS.FAIL_UNITS]: failUnits,
        source: PRINT_SOURCE,
      },
      envelope: { orderId: originId, printerId: done.printerId, units: done.units },
    })) as SignoffPayload;

    last = { printerId: done.printerId, completedAt: done.completedAt, inspectedBy: signoff.inspectedBy };
    outstanding = signoff.failedUnits ?? []; // the rejected units re-enter the funnel next pass
    attempt += 1;
  }

  const result: PrintOrderResult = {
    orderId,
    printed: true,
    printerId: last.printerId,
    role,
    units: order.units.length,
    completedAt: last.completedAt,
    inspectedBy: last.inspectedBy,
    passed: outstanding.length === 0,
    failedUnits: outstanding,
    attempts: attempt,
  };
  return { type: 'return' as const, data: result };
}

// ── printer: the elevated station loop (supply) ──────────────────────────────

export async function printer(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as PrinterData;
  const ctx = Durable.workflow.workflowInfo();
  const printerPond = PRINTER_POND[fleetKind(d.diabetic)];

  let totalRuns = d.totalRuns ?? 0;
  let runsUntilRefill = d.runsUntilRefill ?? REFILL_INTERVAL;
  let refills = d.refills ?? 0;

  // The printer's life is bounded (EOL_RUNS), so it loops its advert/suspend in a
  // single execution — the assembly-line idiom of repeated `condition` calls, not
  // a continueAsNew loop. Each iteration writes one advert and waits to be resolved.
  while (totalRuns < EOL_RUNS) {
    const baseFacets = {
      [PRINTER_FACETS.PRINTER_ID]: d.printerId,
      [PRINTER_FACETS.FILAMENT]: d.filament,
      [PRINTER_FACETS.SIZE_CLASS]: d.sizeClass,
      [PRINTER_FACETS.TOTAL_RUNS]: totalRuns,
    };

    // Needs filament — advertise maintenance; a technician resolves "added filament".
    if (runsUntilRefill <= 0) {
      const refillSignal = `refill-${ctx.workflowId}-r${totalRuns}`;
      await conditionLT<RefillPayload>(refillSignal, {
        role: printerPond,
        type: PRINT_WORKFLOWS.PRINTER,
        subtype: PRINTER_STATE.MAINTENANCE,
        priority: 1,
        description: `Printer ${d.printerId} needs filament (after run ${totalRuns})`,
        workflowType: PRINT_WORKFLOWS.PRINTER,
        metadata: { ...baseFacets, [PRINTER_FACETS.STATE]: PRINTER_STATE.MAINTENANCE, [PRINTER_FACETS.RUNS_UNTIL_REFILL]: 0 },
        envelope: { printerId: d.printerId, state: PRINTER_STATE.MAINTENANCE },
      });
      runsUntilRefill = REFILL_INTERVAL;
      refills += 1;
      continue;
    }

    // Ready — advertise availability. The broker resolves this advert with a job
    // (orderId + a callback key); the printer runs it and signals the broker back.
    const readySignal = `ready-${ctx.workflowId}-r${totalRuns}`;
    const job = await conditionLT<PrinterJobPayload>(readySignal, {
      role: printerPond,
      type: PRINT_WORKFLOWS.PRINTER,
      subtype: PRINTER_STATE.READY,
      priority: 2,
      description: `Printer ${d.printerId} ready (run ${totalRuns + 1})`,
      workflowType: PRINT_WORKFLOWS.PRINTER,
      metadata: { ...baseFacets, [PRINTER_FACETS.STATE]: PRINTER_STATE.READY, [PRINTER_FACETS.RUNS_UNTIL_REFILL]: runsUntilRefill },
      envelope: { printerId: d.printerId, state: PRINTER_STATE.READY },
    });

    // A real handoff carries a callback key. Run it, report completion, consume
    // the run. A cancel/timeout (no job) re-advertises without consuming a run.
    if (job && job.callbackKey) {
      await runPrintJob({ job, printerId: d.printerId });
      totalRuns += 1;
      runsUntilRefill -= 1;
    }
  }

  // End of life — the asset retires; its whole story is its escalation trail.
  const result: PrinterResult = { printerId: d.printerId, retired: true, totalRuns, refills };
  return { type: 'return' as const, data: result };
}

// ── printBroker: the market maker (one singleton per fleet) ──────────────────

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
      diabetic: d.diabetic, brokerId: d.brokerId, brokerWorkflowId: ctx.workflowId, tick, phase: 'c', buckets: carried,
    });
    pairings.push(...r.pairings);
    unplaced.push(...r.unplaced);
  }

  // 2. Claim fresh demand only once the backlog is placed — when printers are
  //    scarce, holding the backlog beats piling on claims we cannot put to work.
  if (unplaced.length === 0) {
    const fresh = await claimOrdersForCapacity({ diabetic: d.diabetic, brokerId: d.brokerId });
    if (fresh.matched > 0) {
      const r = await lockPrintersAndHandoff({
        diabetic: d.diabetic, brokerId: d.brokerId, brokerWorkflowId: ctx.workflowId, tick, phase: 'f', buckets: fresh.buckets,
      });
      pairings.push(...r.pairings);
      unplaced.push(...r.unplaced);
    }
  }

  // 3. Harvest: the handoff already dispatched every job, so the whole fleet is
  //    printing in parallel. Collect each printer's completion signal in turn and
  //    settle its order — resolve its insoles and wake it. The order then surfaces
  //    itself to the farmer for signoff on its own; the broker is not blocked by it.
  //    Sequential harvest (not concurrent `condition` waits) is correct because an
  //    early signal is stored and applied when we park on it.
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

// ── farmTechnician: resolve maintenance adverts (one singleton per fleet) ─────

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

// ── farmInspector: sign off completed orders (one singleton per fleet) ────────

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
