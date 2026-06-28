import { Durable } from '@hotmeshio/hotmesh';

import * as userService from '../../services/user';
import {
  fleetKind,
  ORDER_POND,
  PRINTER_POND,
  FARMER_POND,
} from '../../examples/workflows/print-routing/types';
import type {
  PrinterData,
  PrintOrderData,
  Side,
  SizeClass,
} from '../../examples/workflows/print-routing/types';

/** The operator principals a fleet's robots resolve through (see seedPrintOperators). */
export interface PrintOperators {
  brokerId: string;
  technicianId: string;
  inspectorId: string;
  ordererId: string;
  printerOperatorId: string;
}

/**
 * Seed the per-pond operator principals the print-routing robots run as. Every
 * escalation operation flows through the role-gated public API (superadmin / admin /
 * exact role), so each robot must run as a principal holding exactly the pond role it
 * acts on:
 *   broker      → printer pond (handoff) + order pond (settle/claim)
 *   technician  → printer pond (refill, power-down)
 *   inspector   → farmer pond (signoff)
 *   orderer     → order pond (enqueue demand units)
 *   printer     → printer pond (resolve the broker's callback advert)
 * This is the realistic, teachable shape — the example proves the gated path, not an
 * open door. Returns the operators' user ids to thread into the robot start data.
 */
export async function seedPrintOperators(diabetic: boolean): Promise<PrintOperators> {
  const kind = fleetKind(diabetic);
  const suffix = Durable.guid().slice(0, 8);
  const [broker, technician, inspector, orderer, printer] = await Promise.all([
    userService.createUser({
      external_id: `print-broker-${kind}-${suffix}`,
      display_name: `Print Broker (${kind})`,
      roles: [
        { role: PRINTER_POND[kind], type: 'member' },
        { role: ORDER_POND[kind], type: 'member' },
      ],
    }),
    userService.createUser({
      external_id: `print-technician-${kind}-${suffix}`,
      display_name: `Print Technician (${kind})`,
      roles: [{ role: PRINTER_POND[kind], type: 'member' }],
    }),
    userService.createUser({
      external_id: `print-inspector-${kind}-${suffix}`,
      display_name: `Print Inspector (${kind})`,
      roles: [{ role: FARMER_POND[kind], type: 'member' }],
    }),
    userService.createUser({
      external_id: `print-orderer-${kind}-${suffix}`,
      display_name: `Print Orderer (${kind})`,
      roles: [{ role: ORDER_POND[kind], type: 'member' }],
    }),
    userService.createUser({
      external_id: `print-printer-${kind}-${suffix}`,
      display_name: `Print Printer Operator (${kind})`,
      roles: [{ role: PRINTER_POND[kind], type: 'member' }],
    }),
  ]);
  return {
    brokerId: broker.id,
    technicianId: technician.id,
    inspectorId: inspector.id,
    ordererId: orderer.id,
    printerOperatorId: printer.id,
  };
}

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
