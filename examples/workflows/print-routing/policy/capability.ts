/**
 * Soft capability — which printers can serve an order, *beyond* the hard role wall.
 * The funnel's second stage: rank the eligible set, do not gate it. A standard order
 * prefers a standard printer but overflows to a larger xl printer when standard
 * capacity is full; an xl order needs an xl printer — a hard physical fit, no
 * overflow. xl printers are the scarce resource, so the broker spends them on xl
 * orders first and lets the leftovers absorb standard overflow.
 */

import type { SizeClass } from '../types';

/** Printer size-classes that can serve an order of this size, in preference order. */
export function eligiblePrinterClasses(orderSizeClass: SizeClass): SizeClass[] {
  return orderSizeClass === 'xl' ? ['xl'] : ['standard', 'xl'];
}

/** Whether a printer can serve an order: same filament, and physically large enough. */
export function canServe(
  printer: { filament: string; sizeClass: SizeClass },
  order: { filament: string; sizeClass: SizeClass },
): boolean {
  if (printer.filament !== order.filament) return false;
  return order.sizeClass === 'standard' || printer.sizeClass === 'xl';
}
