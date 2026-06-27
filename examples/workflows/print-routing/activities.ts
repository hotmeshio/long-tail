/**
 * Print Routing activities — side effects outside the durable sandbox. The broker
 * is a *coordinator*: it claims orders by priority (demand), all-or-none locks the
 * printer set it anticipated (supply), hands each printer its job, and waits for
 * the printer to report completion. The escalation queue is the rendezvous bus for
 * every handoff.
 *
 *   enqueueOrderUnits        → write the order's insole escalations (one origin group)
 *   claimOrdersForCapacity   → anticipate free printers, claim that many orders by priority
 *   lockPrintersAndHandoff   → all-or-none batch-claim the printer set, hand each its job
 *   settleOrder              → resolve an order's insoles and wake the order workflow
 *   runPrintJob              → (printer side) report completion back to the broker
 *   technicianRefill         → resolve `needs-filament` adverts ("added filament")
 *   signalOrder              → wake an order once its insoles print
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../../lib/db';
import * as escalationService from '../../../services/escalation';
import * as escalationApi from '../../../api/escalations';
import type { ClaimedGroup, FacetOrder, FacetQuery } from '../../../types';

import { manifestFacets } from './manifest';
import {
  ORDER_POND,
  PRINTER_POND,
  FARMER_POND,
  PRINT_ROUTING_QUEUE,
  PRINT_WORKFLOWS,
  PRINT_FACETS,
  PRINTER_FACETS,
  PRINTER_STATE,
  PRINT_SOURCE,
  SIGNOFF_FACETS,
  fleetKind,
} from './types';
import type {
  BrokerData,
  BrokerPairing,
  ClaimPlan,
  ClaimedOrderBucket,
  InspectorData,
  PrinterJobPayload,
  PrintCallbackPayload,
  PrintOrderData,
  RefillSummary,
  SignoffSummary,
  SizeClass,
  TechnicianData,
} from './types';

// ── Enqueue: write the order's insole escalations (the origin group) ─────────

export async function enqueueOrderUnits(input: {
  order: PrintOrderData;
  /** The group origin — the order id on the first pass, an attempt-scoped id on a reprint. */
  originId: string;
  /** Which of the order's unit indices to enqueue this pass (all, then just the deficit). */
  unitIndices: number[];
  role: string;
  orderSignal: string;
  workflowId: string;
}): Promise<{ originId: string; created: number }> {
  const { order, originId, unitIndices, role, orderSignal, workflowId } = input;
  const orderSize = unitIndices.length; // the group is complete at this many — deficit-sized on a reprint
  for (const idx of unitIndices) {
    const facets = manifestFacets(order, idx, orderSignal, orderSize);
    await escalationService.createEscalation({
      type: PRINT_WORKFLOWS.ORDER,
      subtype: `unit-${idx}`,
      description: `Print ${facets.side} insole (unit ${idx}) — order ${originId}`,
      priority: 2,
      role,
      origin_id: originId,
      workflow_id: workflowId,
      task_queue: PRINT_ROUTING_QUEUE,
      workflow_type: PRINT_WORKFLOWS.ORDER,
      envelope: JSON.stringify({ orderId: originId, unitIndex: idx, customerId: order.customerId }),
      metadata: { ...facets, source: PRINT_SOURCE },
    });
  }
  return { originId, created: orderSize };
}

// ── Broker step 1: anticipate capacity, claim orders by priority ─────────────

/** Sort claimable orders by jeopardy (soonest deadline), large orders first. */
function jeopardyOrder(): FacetOrder[] {
  return [
    { field: `metadata.${PRINT_FACETS.MUST_COMPLETE_BY}`, numeric: true, direction: 'asc' },
    { field: `metadata.${PRINT_FACETS.ORDER_SIZE}`, numeric: true, direction: 'desc' },
  ];
}

/**
 * Read the free printers (availability is a query, not a hash), bucket them by
 * capability, and claim that many complete orders per bucket in jeopardy order.
 * Claiming demand sized to anticipated supply is what keeps priority the deciding
 * factor and stops the broker from over-claiming orders it cannot place.
 */
export async function claimOrdersForCapacity(input: BrokerData): Promise<ClaimPlan> {
  const kind = fleetKind(input.diabetic);
  const orderPond = ORDER_POND[kind];
  const printerPond = PRINTER_POND[kind];
  const consumer = input.brokerId ?? `broker-${kind}`;

  const { escalations } = await escalationService.searchByFacets({
    role: printerPond,
    status: 'pending',
    available: true,
    facets: { [PRINTER_FACETS.STATE]: PRINTER_STATE.READY },
    limit: 200,
  });

  const capacity = new Map<string, { filament: string; sizeClass: SizeClass; count: number }>();
  for (const e of escalations) {
    const m = (e.metadata ?? {}) as Record<string, any>;
    const filament = m[PRINTER_FACETS.FILAMENT];
    const sizeClass = m[PRINTER_FACETS.SIZE_CLASS] as SizeClass;
    const key = `${filament}|${sizeClass}`;
    const slot = capacity.get(key) ?? { filament, sizeClass, count: 0 };
    slot.count += 1;
    capacity.set(key, slot);
  }

  const buckets: ClaimedOrderBucket[] = [];
  let matched = 0;
  for (const { filament, sizeClass, count } of capacity.values()) {
    const query: FacetQuery = {
      role: orderPond,
      available: true,
      facets: { [PRINT_FACETS.FILAMENT]: filament, [PRINT_FACETS.SIZE_CLASS]: sizeClass },
      orderBy: jeopardyOrder(),
    };
    const groups = await escalationService.claimGroups(query, consumer, {
      limit: count,
      sizeFacet: PRINT_FACETS.ORDER_SIZE,
    });
    if (groups.length) {
      buckets.push({ filament, sizeClass, groups });
      matched += groups.length;
    }
  }
  return { buckets, matched };
}

// ── Broker step 2: all-or-none lock the printer set, hand off the jobs ────────

/**
 * Best-effort batch-claim printers for each bucket of claimed orders, then hand
 * each locked printer its job by resolving its advert — which wakes the printer
 * (Path 0) with `{ orderId, callbackKey, brokerWorkflowId }`. The broker waits on
 * `callbackKey` next; the printer signals it on completion.
 *
 * Holding beats releasing: take as many free printers as `claimByFacets` can lock
 * (FOR UPDATE SKIP LOCKED), place that many orders, and return the rest as
 * `unplaced` for the broker to carry. The orders stay claimed and converge next
 * tick instead of churning through release+reclaim — and partial placement keeps
 * the fleet busy where an all-or-none set lock would idle under broker contention.
 * `phase` namespaces the callback keys so multiple lock passes in one tick stay
 * unique.
 */
export async function lockPrintersAndHandoff(input: {
  diabetic: boolean;
  brokerId?: string;
  brokerWorkflowId: string;
  tick: number;
  phase: string;
  buckets: ClaimedOrderBucket[];
}): Promise<{ pairings: BrokerPairing[]; unplaced: ClaimedOrderBucket[] }> {
  const kind = fleetKind(input.diabetic);
  const printerPond = PRINTER_POND[kind];
  const consumer = input.brokerId ?? `broker-${kind}`;
  const pairings: BrokerPairing[] = [];
  const unplaced: ClaimedOrderBucket[] = [];
  let seq = 0;

  for (const bucket of input.buckets) {
    if (!bucket.groups.length) continue;
    const printers = await escalationService.claimByFacets(
      {
        role: printerPond,
        facets: {
          [PRINTER_FACETS.STATE]: PRINTER_STATE.READY,
          [PRINTER_FACETS.FILAMENT]: bucket.filament,
          [PRINTER_FACETS.SIZE_CLASS]: bucket.sizeClass,
        },
      },
      consumer,
      { limit: bucket.groups.length },
    );

    const place = Math.min(printers.length, bucket.groups.length);
    for (let i = 0; i < place; i++) {
      const group = bucket.groups[i];
      const advert = printers[i];
      const m = (advert.metadata ?? {}) as Record<string, any>;
      const printerId = m[PRINTER_FACETS.PRINTER_ID];
      const callbackKey = `cb-${input.brokerWorkflowId}-${printerId}-t${input.tick}-${input.phase}${seq++}`;
      const job: PrinterJobPayload = {
        orderId: group.originId,
        units: group.members.length,
        callbackKey,
        brokerWorkflowId: input.brokerWorkflowId,
      };
      await escalationApi.resolveEscalation({ id: advert.id, resolverPayload: job }, { userId: consumer });
      pairings.push({ callbackKey, printerId, group });
    }

    if (place < bucket.groups.length) {
      // No printer for these orders this tick — carry them, still claimed.
      unplaced.push({ filament: bucket.filament, sizeClass: bucket.sizeClass, groups: bucket.groups.slice(place) });
    }
  }
  return { pairings, unplaced };
}

// ── Broker step 3: settle an order once its printer reports done ──────────────

export async function settleOrder(input: {
  group: ClaimedGroup;
  printerId: string;
  done: PrintCallbackPayload;
}): Promise<void> {
  const { group, printerId, done } = input;
  for (const member of group.members) {
    await escalationService.resolveEscalation(member.id, { printerId });
  }
  const head = group.members[0];
  const meta = (head.metadata ?? {}) as Record<string, any>;
  await signalOrder({
    taskQueue: head.task_queue ?? PRINT_ROUTING_QUEUE,
    workflowType: head.workflow_type ?? PRINT_WORKFLOWS.ORDER,
    workflowId: head.workflow_id ?? '',
    signalId: meta[PRINT_FACETS.ORDER_SIGNAL],
    data: {
      orderId: group.originId,
      printerId,
      role: head.role,
      units: group.members.length,
      completedAt: done.completedAt,
    },
  });
}

// ── Farmer: inspect and sign off completed orders ────────────────────────────

/**
 * Resolve pending order-done signoff escalations in the farmer pond. "Inspected,
 * passed" is an ordinary resolver payload — the same human-in-the-loop mechanism
 * the platform uses everywhere; automated here so the example self-drains. The
 * resolution wakes the broker waiting on the signoff key, which then wakes the order.
 */
export async function inspectorSignoff(input: InspectorData): Promise<SignoffSummary> {
  const kind = fleetKind(input.diabetic);
  const farmerPond = FARMER_POND[kind];
  const inspectorId = input.inspectorId ?? `inspector-${kind}`;

  const { escalations } = await escalationService.searchByFacets({
    role: farmerPond,
    status: 'pending',
    available: true,
    limit: 100,
  });

  const signedOff: string[] = [];
  for (const e of escalations) {
    const m = (e.metadata ?? {}) as Record<string, any>;
    const failedUnits: number[] = Array.isArray(m[SIGNOFF_FACETS.FAIL_UNITS]) ? m[SIGNOFF_FACETS.FAIL_UNITS] : [];
    const res = await escalationApi.resolveEscalation(
      { id: e.id, resolverPayload: { passed: failedUnits.length === 0, inspectedBy: inspectorId, failedUnits } },
      { userId: inspectorId },
    );
    if (res.status === 200) signedOff.push(m[SIGNOFF_FACETS.ORDER_ID]);
  }
  return { signedOff: signedOff.length, orderIds: signedOff };
}

// ── Printer side: report completion back to the broker ───────────────────────

/**
 * The printer's "print": run the job, then signal the broker's deterministic
 * callback key. An early signal (the broker has not parked yet) is stored and
 * applied when the broker's condition registers — the rendezvous is order-safe.
 */
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
  const client = new Durable.Client({ connection: getConnection() });
  const handle = await client.workflow.getHandle(
    PRINT_ROUTING_QUEUE,
    PRINT_WORKFLOWS.BROKER,
    job.brokerWorkflowId,
  );
  await handle.signal(job.callbackKey, payload);
}

// ── Technician: resolve maintenance adverts ("added filament") ───────────────

export async function technicianRefill(input: TechnicianData): Promise<RefillSummary> {
  const kind = fleetKind(input.diabetic);
  const printerPond = PRINTER_POND[kind];
  const technicianId = input.technicianId ?? `tech-${kind}`;

  const { escalations } = await escalationService.searchByFacets({
    role: printerPond,
    status: 'pending',
    available: true,
    facets: { [PRINTER_FACETS.STATE]: PRINTER_STATE.MAINTENANCE },
    limit: 100,
  });

  const refilled: string[] = [];
  for (const e of escalations) {
    const res = await escalationApi.resolveEscalation(
      { id: e.id, resolverPayload: { action: 'added-filament' } },
      { userId: technicianId },
    );
    if (res.status === 200) {
      const m = (e.metadata ?? {}) as Record<string, any>;
      refilled.push(m[PRINTER_FACETS.PRINTER_ID]);
    }
  }
  return { refilled: refilled.length, printerIds: refilled };
}

// ── Signal the order when its print finishes ─────────────────────────────────

export async function signalOrder(input: {
  taskQueue: string;
  workflowType: string;
  workflowId: string;
  signalId: string;
  data: Record<string, any>;
}): Promise<void> {
  const client = new Durable.Client({ connection: getConnection() });
  const handle = await client.workflow.getHandle(
    input.taskQueue,
    input.workflowType,
    input.workflowId,
  );
  await handle.signal(input.signalId, input.data);
}
