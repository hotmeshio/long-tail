import type {
  PrinterData,
  PrintOrderData,
  Side,
  SizeClass,
} from '../../examples/workflows/print-routing/types';

/** One diabetic printer that serves the EOL lane (pla / standard). */
export function buildEolPrinter(suffix: string): PrinterData {
  return {
    printerId: `eol-printer-${suffix}`,
    diabetic: true,
    filament: 'pla',
    sizeClass: 'standard',
  };
}

/**
 * Exactly 10 diabetic pla/standard orders of 4–6 insoles, staggered deadlines so
 * jeopardy ordering has something to sort. One printer (EOL = 10 runs) drains all
 * 10 — surviving through its final run before it retires.
 */
export function buildEolOrders(now: number, suffix: string): PrintOrderData[] {
  return Array.from({ length: 10 }, (_, i) => ({
    orderId: `eol-order-${i}-${suffix}`,
    diabetic: true,
    customerId: `cust-${i}`,
    filament: 'pla',
    sizeClass: 'standard' as SizeClass,
    units: Array.from({ length: 4 + (i % 3) }, (_, j) => ({
      side: (j % 2 === 0 ? 'L' : 'R') as Side,
    })),
    approvedAt: now,
    mustCompleteBy: now + (i + 1) * 60_000,
  }));
}

/** A diabetic farm: three `pla/standard` machines and one `pla/xl`. */
export function buildFarm(suffix: string): PrinterData[] {
  const std = (n: number): PrinterData => ({
    printerId: `farm-std-${n}-${suffix}`,
    diabetic: true,
    filament: 'pla',
    sizeClass: 'standard',
  });
  return [
    std(1),
    std(2),
    std(3),
    { printerId: `farm-xl-1-${suffix}`, diabetic: true, filament: 'pla', sizeClass: 'xl' },
  ];
}

/**
 * Nine `pla/standard` orders + three `pla/xl` orders of 4–6 insoles, staggered
 * deadlines. The fleet drains them concurrently: standard work spreads across the
 * three standard machines, xl work routes to the lone xl machine (hard capability).
 */
export function buildFarmOrders(now: number, suffix: string): PrintOrderData[] {
  const make = (i: number, sizeClass: SizeClass): PrintOrderData => ({
    orderId: `farm-order-${sizeClass}-${i}-${suffix}`,
    diabetic: true,
    customerId: `cust-${sizeClass}-${i}`,
    filament: 'pla',
    sizeClass,
    units: Array.from({ length: 4 + (i % 3) }, (_, j) => ({
      side: (j % 2 === 0 ? 'L' : 'R') as Side,
    })),
    approvedAt: now,
    mustCompleteBy: now + (i + 1) * 60_000,
  });
  const standard = Array.from({ length: 9 }, (_, i) => make(i, 'standard'));
  const xl = Array.from({ length: 3 }, (_, i) => make(i, 'xl'));
  return [...standard, ...xl];
}
