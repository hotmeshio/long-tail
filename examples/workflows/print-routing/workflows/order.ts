/**
 * printOrder — the demand actor and the convergence owner. It runs a fixpoint loop:
 * each pass prints the outstanding units, the farmer inspects them, and whatever is
 * rejected re-enters the *same* funnel as a fresh deficit group — until intent ≡
 * actual. A route is a hypothesis; the durable loop converges it. Only the order
 * holds the original intent, so the reconciliation lives here.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { conditionLT } from '../../../../services/orchestrator/condition';
import type { LTEnvelope } from '../../../../types';

import { enqueueOrderUnits } from './proxy';
import {
  roleForOrder,
  fleetKind,
  FARMER_POND,
  PRINT_WORKFLOWS,
  ORDER_SIGNOFF_TYPE,
  SIGNOFF_FACETS,
  PRINT_SOURCE,
  MAX_PRINT_ATTEMPTS,
} from '../types';
import type {
  PrintOrderData,
  PrintOrderResult,
  OrderDoneSignal,
  SignoffPayload,
} from '../types';

export async function printOrder(envelope: LTEnvelope): Promise<any> {
  const order = envelope.data as PrintOrderData;
  const ctx = Durable.workflow.workflowInfo();
  const orderId = order.orderId ?? ctx.workflowId;
  const role = roleForOrder(order.diabetic);
  const farmerPond = FARMER_POND[fleetKind(order.diabetic)];

  if (!order.operatorId) throw new Error('printOrder requires order.operatorId (the order pond operator)');
  const operatorId = order.operatorId;
  let outstanding = order.units.map((_, i) => i);
  let attempt = 0;
  let last = { printerId: '', completedAt: '', inspectedBy: '' };

  while (outstanding.length > 0 && attempt < MAX_PRINT_ATTEMPTS) {
    const orderSignal = `order-done-${ctx.workflowId}-a${attempt}`;
    const originId = attempt === 0 ? orderId : `${orderId}#a${attempt}`;
    await enqueueOrderUnits({ order, originId, unitIndices: outstanding, reprint: attempt > 0, role, orderSignal, workflowId: ctx.workflowId, operatorId });

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
