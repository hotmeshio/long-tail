/**
 * Order activity — write an order's print-job escalations as one origin group.
 * Each unit is a row carrying the searchable facets the broker matches on
 * (filament + required capabilities); the group is claimable only when complete
 * (`orderSize` members), so the printer set is matched all-or-nothing.
 */

import { createClient } from '../../../../sdk';

import { requiredCapabilities } from '../policy';
import {
  PRINT_JOBS,
  TWIN_QUEUE,
  TWIN_WORKFLOWS,
  TWIN_FACETS,
  JOB_FACETS,
  TWIN_SOURCE,
} from '../types';
import type { TwinOrderData } from '../types';

export async function enqueueJobUnits(input: {
  order: TwinOrderData;
  orderId: string;
  orderSignal: string;
  workflowId: string;
  /** Order operator — a principal holding the jobs pond role (create is gated). */
  operatorId: string;
}): Promise<{ orderId: string; created: number }> {
  const { order, orderId, orderSignal, workflowId, operatorId } = input;
  const require = requiredCapabilities({ ...(order.require ?? {}) });

  const lt = createClient({ auth: { userId: operatorId } });

  for (let idx = 0; idx < order.units.length; idx++) {
    const res = await lt.escalations.create({
      type: TWIN_WORKFLOWS.ORDER,
      subtype: `unit-${idx}`,
      description: `Print unit ${idx} — order ${orderId}`,
      priority: order.priority ?? 2,
      role: PRINT_JOBS,
      origin_id: orderId,
      workflow_id: workflowId,
      task_queue: TWIN_QUEUE,
      workflow_type: TWIN_WORKFLOWS.ORDER,
      envelope: JSON.stringify({ orderId, unitIndex: idx }),
      metadata: {
        [JOB_FACETS.ORDER_SIZE]: order.units.length,
        [JOB_FACETS.UNIT_INDEX]: idx,
        [TWIN_FACETS.FILAMENT]: order.filament,
        [JOB_FACETS.ORDER_SIGNAL]: orderSignal,
        [JOB_FACETS.GCODE_URL]: order.units[idx].gcodeUrl,
        ...require,
        source: TWIN_SOURCE,
      },
    });
    if (res.status !== 201) throw new Error(`create escalation failed: ${res.error}`);
  }
  return { orderId, created: order.units.length };
}
