/**
 * Order activity — write an order's insole escalations as one origin group. Each
 * insole is a row carrying the searchable facet set the broker matches on; the
 * group is complete (claimable) at `unitIndices.length` members.
 */

import * as escalationService from '../../../../services/escalation';

import { manifestFacets } from '../policy';
import {
  PRINT_ROUTING_QUEUE,
  PRINT_WORKFLOWS,
  PRINT_FACETS,
  PRINT_SOURCE,
} from '../types';
import type { PrintOrderData } from '../types';

export async function enqueueOrderUnits(input: {
  order: PrintOrderData;
  /** The group origin — the order id on the first pass, an attempt-scoped id on a reprint. */
  originId: string;
  /** Which of the order's unit indices to enqueue this pass (all, then just the deficit). */
  unitIndices: number[];
  /** A reprint group (a deficit re-run) leads the queue under the reprint rule. */
  reprint: boolean;
  role: string;
  orderSignal: string;
  workflowId: string;
}): Promise<{ originId: string; created: number }> {
  const { order, originId, unitIndices, reprint, role, orderSignal, workflowId } = input;
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
      metadata: { ...facets, [PRINT_FACETS.REPRINT]: reprint, source: PRINT_SOURCE },
    });
  }
  return { originId, created: orderSize };
}
