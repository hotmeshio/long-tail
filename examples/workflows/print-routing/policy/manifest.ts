/**
 * Manifest — at enqueue, it computes the searchable facet set for each insole of
 * an order: the capabilities a printer must have (filament, size), the jeopardy
 * deadline, the unit count, the key-account flag, and the order's wake signal. In
 * production it would also resolve the candidate printer set from the catalog; here
 * it normalizes the order's declared fields into the metadata the broker queries.
 */

import { isKeyAccount } from './priority';
import type { OrderFacets, PrintOrderData } from '../types';

export function manifestFacets(
  order: PrintOrderData,
  unitIndex: number,
  orderSignal: string,
  orderSize: number = order.units.length,
): OrderFacets {
  return {
    orderSize,
    unitIndex,
    side: order.units[unitIndex].side,
    filament: order.filament,
    sizeClass: order.sizeClass,
    diabetic: order.diabetic,
    customerId: order.customerId,
    approvedAt: order.approvedAt,
    mustCompleteBy: order.mustCompleteBy,
    orderSignal,
    keyAccount: isKeyAccount(order.customerId),
  };
}
