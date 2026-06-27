/**
 * Print Routing types & policy — an enterprise print farm where printers are
 * first-class durable workflows.
 *
 * Two ponds on one primitive: orders (demand) advertise insole escalations, and
 * printers (supply) advertise availability escalations. The platform knows none
 * of it: `diabetic` is the hard capability wall (isolated role queues), and the
 * rest are metadata facets a broker sorts and intersects. A printer's whole life
 * — ready, printing, refilling, retired — is the trace of its escalations.
 */

import type { ClaimedGroup } from '../../../types';

// ── Roles (hard capability walls) ────────────────────────────────────────────

/** Demand pond — orders. Diabetic insoles are isolated from standard. */
export const PRINT_FARM_DIABETIC = 'print-farm-diabetic';
export const PRINT_FARM_STANDARD = 'print-farm-standard';

/** Supply pond — printer adverts. One pool per fleet the printers serve. */
export const PRINTER_POOL_DIABETIC = 'printer-pool-diabetic';
export const PRINTER_POOL_STANDARD = 'printer-pool-standard';

/** Signoff pond — order-done escalations the farmer inspects and clears. */
export const PRINT_FARMER_DIABETIC = 'print-farmer-diabetic';
export const PRINT_FARMER_STANDARD = 'print-farmer-standard';

export const ALL_PRINT_ROLES = [
  PRINT_FARM_DIABETIC,
  PRINT_FARM_STANDARD,
  PRINTER_POOL_DIABETIC,
  PRINTER_POOL_STANDARD,
  PRINT_FARMER_DIABETIC,
  PRINT_FARMER_STANDARD,
] as const;

export type FleetKind = 'diabetic' | 'standard';

export function fleetKind(diabetic: boolean): FleetKind {
  return diabetic ? 'diabetic' : 'standard';
}

/** The order pond a fleet draws demand from. */
export const ORDER_POND: Record<FleetKind, string> = {
  diabetic: PRINT_FARM_DIABETIC,
  standard: PRINT_FARM_STANDARD,
};

/** The printer pond a fleet's printers advertise into. */
export const PRINTER_POND: Record<FleetKind, string> = {
  diabetic: PRINTER_POOL_DIABETIC,
  standard: PRINTER_POOL_STANDARD,
};

/** The signoff pond a fleet's completed orders surface to the farmer in. */
export const FARMER_POND: Record<FleetKind, string> = {
  diabetic: PRINT_FARMER_DIABETIC,
  standard: PRINT_FARMER_STANDARD,
};

/** The hard switch for an order → its demand pond role. */
export function roleForOrder(diabetic: boolean): string {
  return ORDER_POND[fleetKind(diabetic)];
}

export const PRINT_ROUTING_QUEUE = 'long-tail-examples';

/** Registered workflow function names (also each row's `workflow_type`). */
export const PRINT_WORKFLOWS = {
  ORDER: 'printOrder',
  PRINTER: 'printer',
  BROKER: 'printBroker',
  TECHNICIAN: 'farmTechnician',
  INSPECTOR: 'farmInspector',
} as const;

/** Escalation type for an order-done signoff the farmer inspects. */
export const ORDER_SIGNOFF_TYPE = 'order-signoff';

/** Metadata keys on an order-done signoff escalation. */
export const SIGNOFF_FACETS = {
  ORDER_ID: 'orderId',
  PRINTER_ID: 'printerId',
  UNITS: 'units',
  FAIL_UNITS: 'failUnits',
} as const;

// ── Facet keys ───────────────────────────────────────────────────────────────

/** Order insole facets. `ORDER_SIZE` drives group completeness. */
export const PRINT_FACETS = {
  ORDER_SIZE: 'orderSize',
  UNIT_INDEX: 'unitIndex',
  SIDE: 'side',
  FILAMENT: 'filament',
  SIZE_CLASS: 'sizeClass',
  DIABETIC: 'diabetic',
  CUSTOMER_ID: 'customerId',
  APPROVED_AT: 'approvedAt',
  MUST_COMPLETE_BY: 'mustCompleteBy',
  ORDER_SIGNAL: 'orderSignal',
  KEY_ACCOUNT: 'keyAccount',
  REPRINT: 'reprint',
} as const;

/** Printer advert facets. `STATE` says who resolves it: broker vs technician. */
export const PRINTER_FACETS = {
  PRINTER_ID: 'printerId',
  STATE: 'state',
  FILAMENT: 'filament',
  SIZE_CLASS: 'sizeClass',
  TOTAL_RUNS: 'totalRuns',
  RUNS_UNTIL_REFILL: 'runsUntilRefill',
} as const;

export const PRINTER_STATE = {
  READY: 'ready',
  MAINTENANCE: 'maintenance',
} as const;

export const PRINT_SOURCE = 'print-routing';

/** A printer prints this many runs between filament refills. */
export const REFILL_INTERVAL = 3;
/** A printer retires (end-of-life) after this many total runs. */
export const EOL_RUNS = 10;

/** An order gives up reprinting a stubborn defect after this many attempts. */
export const MAX_PRINT_ATTEMPTS = 5;

// ── Order shapes (demand) ────────────────────────────────────────────────────

export type SizeClass = 'xl' | 'standard';
export type Side = 'L' | 'R';

export interface PrintUnitSpec {
  side: Side;
}

export interface PrintOrderData {
  orderId?: string;
  diabetic: boolean;
  customerId: string;
  filament: string;
  sizeClass: SizeClass;
  units: PrintUnitSpec[];
  approvedAt: number;
  mustCompleteBy: number;
  /** Example control: unit indices the farmer finds defective at inspection. */
  failUnits?: number[];
}

export interface OrderFacets {
  orderSize: number;
  unitIndex: number;
  side: Side;
  filament: string;
  sizeClass: SizeClass;
  diabetic: boolean;
  customerId: string;
  approvedAt: number;
  mustCompleteBy: number;
  orderSignal: string;
  /** Whether this order belongs to a key account — a priority-rule facet. */
  keyAccount: boolean;
}

export interface PrintOrderResult {
  orderId: string;
  printed: boolean;
  printerId: string;
  role: string;
  units: number;
  completedAt: string;
  inspectedBy: string;
  passed: boolean;
  /** Unit indices still failing when the order stopped — empty when it converged. */
  failedUnits: number[];
  /** How many print→inspect passes it took to converge (1 = clean, first try). */
  attempts: number;
}

/** The wake signal the broker sends an order once printed (before farmer signoff). */
export interface OrderDoneSignal {
  orderId: string | null;
  printerId: string;
  role: string;
  units: number;
  completedAt: string;
}

/** The farmer's resolution of an order-done signoff escalation. */
export interface SignoffPayload {
  passed: boolean;
  inspectedBy: string;
  /** Unit indices found defective — empty when the whole order passed. */
  failedUnits: number[];
  notes?: string;
}

// ── Printer shapes (supply) ──────────────────────────────────────────────────

export interface PrinterData {
  printerId: string;
  diabetic: boolean;
  filament: string;
  sizeClass: SizeClass;
  totalRuns?: number;
  runsUntilRefill?: number;
  refills?: number;
}

export interface PrinterResult {
  printerId: string;
  retired: boolean;
  totalRuns: number;
  refills: number;
}

export type PrintOutcome = 'success' | 'fail' | 'cancel';

/** Resolution of a `maintenance` advert — the technician's action. */
export interface RefillPayload {
  action: 'added-filament';
}

/**
 * The job the broker hands a printer by resolving the printer's `ready` advert.
 * Resolving wakes the printer (Path 0); the printer signals `callbackKey` on the
 * broker workflow when the run completes.
 */
export interface PrinterJobPayload {
  orderId: string | null;
  units: number;
  callbackKey: string;
  brokerWorkflowId: string;
}

/** The printer's completion report, signaled back to the broker's callback key. */
export interface PrintCallbackPayload {
  result: PrintOutcome;
  printerId: string;
  orderId: string | null;
  units: number;
  completedAt: string;
}

/** One capability bucket of claimed orders (output of `claimOrdersForCapacity`). */
export interface ClaimedOrderBucket {
  filament: string;
  sizeClass: SizeClass;
  groups: ClaimedGroup[];
}

/** Orders the broker claimed this tick, grouped by capability bucket. */
export interface ClaimPlan {
  buckets: ClaimedOrderBucket[];
  matched: number;
}

/** A locked printer paired to a claimed order, carrying the rendezvous key. */
export interface BrokerPairing {
  callbackKey: string;
  printerId: string;
  group: ClaimedGroup;
}

// ── Broker & technician (outsiders) ──────────────────────────────────────────

export interface BrokerData {
  diabetic: boolean;
  brokerId?: string;
  tickSeconds?: number;
  idleTickSeconds?: number;
  maxIdleRuns?: number;
  cumulative?: BrokerTotals;
  idleRuns?: number;
  /** Orders claimed but not yet placed on a printer — carried across continueAsNew. */
  carried?: ClaimedOrderBucket[];
  /** Ordered priority-rule names (see priority.ts). Defaults to the standing policy. */
  priorityRules?: string[];
}

export interface BrokerTotals {
  ordersPrinted: number;
  runs: number;
}

export interface TechnicianData {
  diabetic: boolean;
  technicianId?: string;
  tickSeconds?: number;
  idleTickSeconds?: number;
  maxIdleRuns?: number;
  cumulative?: number;
  idleRuns?: number;
}

export interface RefillSummary {
  refilled: number;
  printerIds: string[];
}

export interface InspectorData {
  diabetic: boolean;
  inspectorId?: string;
  tickSeconds?: number;
  idleTickSeconds?: number;
  maxIdleRuns?: number;
  cumulative?: number;
  idleRuns?: number;
}

export interface SignoffSummary {
  signedOff: number;
  orderIds: string[];
}
