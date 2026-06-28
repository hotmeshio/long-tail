/**
 * Shift-side activities — the demo's side effects, kept out of the durable sandbox
 * so they can read the wall clock and the live pond.
 *
 *   buildShiftPlan        composes the scenario (a near-EOL printer + a fresh one,
 *                         and three flavor waves: priority, defect, lifecycle) with
 *                         real timestamps. The workflow stays deterministic.
 *   powerDownIdlePrinters sweeps the pool for THIS shift's idle `ready` adverts and
 *                         resolves them with a power-down — retiring printers the
 *                         work no longer needs so nothing lingers after the floor clears.
 */

import * as escalationService from '../../../../services/escalation';

import {
  fleetKind,
  PRINTER_POND,
  PRINTER_FACETS,
  PRINTER_STATE,
  REFILL_INTERVAL,
  EOL_RUNS,
} from '../types';
import type { ShiftPlan, PrintOrderData, PrinterData, Side, SizeClass } from '../types';

/** A key-account customer — the priority rule jumps its order ahead (see policy/priority.ts). */
const KEY_ACCOUNT_CUSTOMER = 'kacct-1';

function makeOrder(args: {
  suffix: string;
  diabetic: boolean;
  tag: string;
  i: number;
  now: number;
  customerId?: string;
  failUnits?: number[];
  sizeClass?: SizeClass;
}): PrintOrderData {
  const { suffix, diabetic, tag, i, now, customerId, failUnits, sizeClass = 'standard' } = args;
  return {
    orderId: `shift-${tag}-${i}-${suffix}`,
    diabetic,
    customerId: customerId ?? `cust-${tag}-${i}`,
    filament: 'pla',
    sizeClass,
    // 4–6 insoles, alternating sides — a complete-group order.
    units: Array.from({ length: 4 + (i % 3) }, (_, j) => ({
      side: (j % 2 === 0 ? 'L' : 'R') as Side,
    })),
    approvedAt: now,
    // Staggered deadlines so the jeopardy rules have something to sort on.
    mustCompleteBy: now + (i + 1) * 60_000,
    failUnits,
  };
}

/**
 * The standard full-lifecycle scenario: 2 printers, 12 orders across three flavors.
 *
 * Supply — printer A starts near end-of-life (6 of 10 runs done, one run from a
 * refill) so it refills immediately then retires at end-of-life; printer B is fresh
 * and crosses its refills at runs 3/6/9. Combined run capacity sits just above the
 * order book, so one machine reaches end-of-life on its own while the other still
 * has life left when the floor clears — and is powered down. Both ways of bounding
 * a printer show: a natural retirement and an explicit power-down.
 *
 * Demand — three waves, each a dimension:
 *   rush       priority: one key-account order amid standard ones; the broker
 *              claims it first.
 *   defect     convergence: one order with a defective unit; the fixpoint loop
 *              reprints it until intent ≡ actual.
 *   closing    capacity/lifecycle: the remaining orders that drive the refills and
 *              the retirement.
 */
export async function buildShiftPlan(input: {
  suffix: string;
  diabetic: boolean;
}): Promise<ShiftPlan> {
  const { suffix, diabetic } = input;
  const now = Date.now();

  const fleet: PrinterData[] = [
    // Near-EOL: refills on the next run, then retires at end-of-life.
    {
      printerId: `shift-printer-a-${suffix}`,
      diabetic,
      filament: 'pla',
      sizeClass: 'standard',
      totalRuns: EOL_RUNS - REFILL_INTERVAL - 1, // 6 — four runs of life left
      runsUntilRefill: 1,
    },
    // Fresh: the workhorse — refills at 3/6/9.
    {
      printerId: `shift-printer-b-${suffix}`,
      diabetic,
      filament: 'pla',
      sizeClass: 'standard',
    },
  ];

  const rush: PrintOrderData[] = [
    makeOrder({ suffix, diabetic, tag: 'rush', i: 0, now, customerId: KEY_ACCOUNT_CUSTOMER }),
    makeOrder({ suffix, diabetic, tag: 'rush', i: 1, now }),
    makeOrder({ suffix, diabetic, tag: 'rush', i: 2, now }),
    makeOrder({ suffix, diabetic, tag: 'rush', i: 3, now }),
  ];
  const defect: PrintOrderData[] = [
    makeOrder({ suffix, diabetic, tag: 'defect', i: 0, now, failUnits: [0] }),
    makeOrder({ suffix, diabetic, tag: 'defect', i: 1, now }),
  ];
  const closing: PrintOrderData[] = Array.from({ length: 6 }, (_, i) =>
    makeOrder({ suffix, diabetic, tag: 'closing', i, now }),
  );

  return {
    fleet,
    waves: [
      { name: 'rush', orders: rush },
      { name: 'defect', orders: defect },
      { name: 'closing', orders: closing },
    ],
  };
}

/**
 * Retire this shift's idle printers. Reads the fleet's pool for `ready` adverts
 * (a printer parked waiting for a job), keeps only those belonging to this shift,
 * and resolves each with a power-down — the printer breaks its loop and retires.
 * Scoped by `printerIds` so concurrent shifts on the same pond never touch each
 * other's machines. Returns how many were powered down this sweep.
 */
export async function powerDownIdlePrinters(input: {
  diabetic: boolean;
  printerIds: string[];
}): Promise<{ poweredDown: number; printerIds: string[] }> {
  const { diabetic, printerIds } = input;
  const printerPond = PRINTER_POND[fleetKind(diabetic)];
  const mine = new Set(printerIds);

  const { escalations } = await escalationService.searchByFacets({
    role: printerPond,
    facets: { [PRINTER_FACETS.STATE]: PRINTER_STATE.READY },
    status: 'pending',
    available: true,
    limit: 200,
  });

  const idle = escalations.filter((e) => mine.has(String(e.metadata?.[PRINTER_FACETS.PRINTER_ID])));
  const downed: string[] = [];
  for (const advert of idle) {
    const resolved = await escalationService.resolveEscalation(advert.id, { powerdown: true });
    if (resolved) downed.push(String(advert.metadata?.[PRINTER_FACETS.PRINTER_ID]));
  }
  return { poweredDown: downed.length, printerIds: downed };
}
