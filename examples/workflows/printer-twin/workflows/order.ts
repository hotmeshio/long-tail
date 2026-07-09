/**
 * twinOrder — demand. Enqueues one print-job escalation per unit as one origin
 * group (all-or-nothing claimable), then parks until the broker settles the
 * group and wakes it with every unit's outcome.
 *
 * Reprint convergence is deliberately out of scope here: a `cancel`/`fail`
 * outcome surfaces in the result and the processes that own the next phase
 * take over. See print-routing's `printOrder` for the fixpoint-loop version.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';

import { enqueueJobUnits } from './proxy';
import type { TwinOrderData, TwinOrderResult, OrderSettledSignal } from '../types';

export async function twinOrder(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as TwinOrderData;
  if (!d.operatorId) throw new Error('twinOrder requires data.operatorId (a jobs pond operator)');
  if (!d.filament) throw new Error('twinOrder requires data.filament');
  if (!d.units?.length) throw new Error('twinOrder requires at least one unit');
  const ctx = Durable.workflow.workflowInfo();
  const orderId = d.orderId ?? ctx.workflowId;
  const orderSignal = `order-settled-${ctx.workflowId}`;

  // 1. Advertise the demand — one row per unit, one origin group.
  await enqueueJobUnits({
    order: d,
    orderId,
    orderSignal,
    workflowId: ctx.workflowId,
    operatorId: d.operatorId,
  });

  // 2. Park until the broker settles the whole group (a plain signal wait —
  //    the demand rows themselves are the order's visible surface).
  const settled = await Durable.workflow.condition<OrderSettledSignal>(orderSignal);
  const payload: OrderSettledSignal = settled || { orderId, outcomes: [], completedAt: '' };

  const result: TwinOrderResult = {
    orderId,
    units: d.units.length,
    outcomes: payload.outcomes,
    completedAt: payload.completedAt,
  };
  return { type: 'return' as const, data: result };
}
