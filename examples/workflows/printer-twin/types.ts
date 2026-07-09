/**
 * Printer Twin types — the physical/digital twin phase of the print farm.
 *
 * Where print-routing proves the marketplace at throughput (simulated machines),
 * this example binds each durable workflow to a REAL machine on the floor. The
 * twin's escalation surface is its JIT UI: registration and service target the
 * `print-servicer` role (a human at the dashboard); availability adverts target
 * the fleet pond (the broker); the in-flight `printing` row is the physical
 * rendezvous — the farm manager's callback resolves it when the machine reports.
 *
 * See ../print-routing/ARCHITECTURE.md for the marketplace design this builds on.
 */

// ── Roles (hard capability walls) ────────────────────────────────────────────

/** Humans who unbox, register, refill, and repair machines. */
export const PRINT_SERVICER = 'print-servicer';
/** Supply pond — twin availability adverts and in-flight print rows. */
export const PRINTER_FLEET = 'printer-fleet';
/** Demand pond — order print-job escalations, grouped by origin. */
export const PRINT_JOBS = 'print-jobs';

export const ALL_TWIN_ROLES = [PRINT_SERVICER, PRINTER_FLEET, PRINT_JOBS] as const;

export const TWIN_QUEUE = 'long-tail-examples';

/** Registered workflow function names (also each row's `workflow_type`). */
export const TWIN_WORKFLOWS = {
  TWIN: 'printerTwin',
  ORDER: 'twinOrder',
  BROKER: 'twinBroker',
} as const;

export const TWIN_SOURCE = 'printer-twin';

// ── Twin lifecycle states (each is an escalation subtype) ───────────────────

export const TWIN_STATE = {
  /** Unboxed but unknown — waiting for a servicer to describe the machine. */
  REGISTERING: 'registering',
  /** Advertised as available — waiting for the broker to hand off a job. */
  READY: 'ready',
  /** Job dispatched to the physical machine — waiting for its callback. */
  PRINTING: 'printing',
  /** Taken offline (cancelled row) — waiting for a servicer to realign it. */
  SERVICE: 'service',
  /** The broker's side of an in-flight job — resolved by the twin's report. */
  DISPATCHED: 'dispatched',
} as const;

// ── Facet keys ───────────────────────────────────────────────────────────────

/** Twin advert facets — GIN-indexed metadata the broker claims against. */
export const TWIN_FACETS = {
  PRINTER_ID: 'printerId',
  SERIAL_NUMBER: 'serialNumber',
  MODEL: 'model',
  FILAMENT: 'filament',
  STATE: 'state',
} as const;

/**
 * Capability facets a registered twin advertises (booleans). An order that
 * requires one sets it `true` on its demand rows; the broker's set-claim then
 * intersects on exactly the required keys.
 */
export const CAPABILITY_KEYS = ['xl', 'pdac', 'soft'] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export type CapabilitySet = Record<CapabilityKey, boolean>;

/** Demand-row facets. `ORDER_SIZE` drives all-or-nothing group claiming. */
export const JOB_FACETS = {
  ORDER_SIZE: 'orderSize',
  UNIT_INDEX: 'unitIndex',
  FILAMENT: 'filament',
  ORDER_SIGNAL: 'orderSignal',
  GCODE_URL: 'gcodeUrl',
} as const;

/** Outcome facets merged into in-flight rows in the same atomic resolve. */
export const OUTCOME_FACETS = {
  OUTCOME: 'outcome',
  JOB_ID: 'jobId',
} as const;

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Loop iterations per twin execution before continueAsNew bounds the history. */
export const LOOPS_PER_GENERATION = 25;
/** Claim TTL — an orphaned claim (crash mid-handoff) recovers in this window. */
export const DEFAULT_TWIN_CLAIM_MINUTES = 5;
/** Max demand groups the broker claims per tick. */
export const DEFAULT_MAX_GROUPS = 5;
/** Max ready adverts the broker reads per tick (its capacity horizon). */
export const DEFAULT_MAX_ADVERTS = 50;

// ── Registration & service (the print-servicer's forms) ─────────────────────

/**
 * What the servicer records when the machine is unboxed and joined to the farm
 * manager. Captured by the twin as its identity — every subsequent advert
 * carries these facets.
 */
export interface TwinRegistration {
  serialNumber: string;
  model: string;
  manufactureDate: string;
  filament: string;
  certifications: string;
  xl: boolean;
  pdac: boolean;
  soft: boolean;
  notes?: string;
}

/** The servicer's resolution of a `service` escalation. */
export interface TwinServicePayload {
  action: string;
  /** Set when the servicer loaded different filament — the twin updates itself. */
  filamentLoaded?: string;
  notes?: string;
}

// ── Handoff & physical rendezvous payloads ───────────────────────────────────

/**
 * The job the broker hands a twin by resolving its `ready` advert. The twin
 * opens `printDoneKey` as its physical rendezvous row; the farm manager's
 * callback resolves that row. The twin reports back on `callbackKey`.
 */
export interface TwinJobPayload {
  jobId: string;
  orderId: string;
  unitIndex: number;
  gcodeUrl: string;
  /** Signal key of the broker's `dispatched` row — the twin resolves it. */
  callbackKey: string;
  /** Signal key of the twin's `printing` row — the farm manager resolves it. */
  printDoneKey: string;
  brokerWorkflowId: string;
  /** A `ready` advert resolved with this (and no job) retires the twin. */
  powerdown?: boolean;
  /** Set by the platform when the advert was cancelled rather than resolved. */
  __escalation_cancelled?: boolean;
}

export type PrintOutcome = 'success' | 'fail' | 'cancel';

/** What the physical side reports by resolving the twin's `printing` row. */
export interface PrintDonePayload {
  outcome: Exclude<PrintOutcome, 'cancel'>;
  detail?: string;
  reportedBy?: string;
  __escalation_cancelled?: boolean;
}

/** The twin's completion report — resolves the broker's `dispatched` row. */
export interface TwinCallbackPayload {
  outcome: PrintOutcome;
  printerId: string;
  jobId: string;
  orderId: string;
  unitIndex: number;
  completedAt: string;
}

// ── Workflow data shapes ─────────────────────────────────────────────────────

export interface TwinData {
  printerId: string;
  /** Twin operator — a principal holding the fleet pond role (reports outcomes
   *  through the gated public API). Threaded at start; asserted before use. */
  operatorId: string;
  /** Carried across continueAsNew once the servicer registers the machine. */
  registration?: TwinRegistration;
  jobsCompleted?: number;
  services?: number;
  /** Monotonic wait counter — keeps signal keys unique across generations. */
  seq?: number;
}

export interface TwinResult {
  printerId: string;
  retired: boolean;
  jobsCompleted: number;
  services: number;
}

export interface TwinOrderData {
  orderId?: string;
  filament: string;
  /** Capabilities every printer in the claimed set must have (true = required). */
  require?: Partial<CapabilitySet>;
  /** One gcode reference per unit — a signed URL the farm manager downloads. */
  units: { gcodeUrl: string }[];
  priority?: number;
  /** Order operator — a principal holding the jobs pond role (create is gated). */
  operatorId: string;
}

/** The settle signal the broker sends the order once every unit reported. */
export interface OrderSettledSignal {
  orderId: string;
  outcomes: TwinCallbackPayload[];
  completedAt: string;
}

export interface TwinOrderResult {
  orderId: string;
  units: number;
  outcomes: TwinCallbackPayload[];
  completedAt: string;
}

export interface TwinBrokerData {
  /** Broker operator — a principal holding the fleet AND jobs pond roles. */
  brokerId: string;
  tickSeconds?: number;
  idleTickSeconds?: number;
  maxIdleRuns?: number;
  claimMinutes?: number;
  maxGroups?: number;
  maxAdverts?: number;
  cumulative?: TwinBrokerTotals;
  idleRuns?: number;
}

export interface TwinBrokerTotals {
  jobsDispatched: number;
  ordersSettled: number;
  runs: number;
}

/** A locked twin paired to one demand unit, carrying both rendezvous keys. */
export interface TwinPairing {
  printerId: string;
  serialNumber: string;
  model: string;
  jobId: string;
  orderId: string;
  unitIndex: number;
  gcodeUrl: string;
  callbackKey: string;
  printDoneKey: string;
}

/** One claimed demand group plus the pairings its handoff produced. */
export interface HandoffResult {
  pairings: TwinPairing[];
  /** True when no complete printer set was available — the group's claim
   *  TTL-expires back to the pool and is re-claimed on a later tick. */
  skipped: boolean;
}
