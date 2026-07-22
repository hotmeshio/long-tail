import type { LTWorkerConfig } from '../types/startup';

import * as reviewContentWorkflow from './workflows/review-content';
import * as kitchenSinkWorkflow from './workflows/kitchen-sink';
import * as basicEchoWorkflow from './workflows/basic-echo';
import * as assemblyLineWorkflow from './workflows/assembly-line';
import * as workstationWorkflow from './workflows/assembly-line/worker';
import * as stepIteratorWorkflow from './workflows/assembly-line/iterator';
import * as reverterWorkflow from './workflows/assembly-line/reverter';
import * as basicSignalWorkflow from './workflows/basic-signal';
import * as efficientSignalWorkflow from './workflows/efficient-signal';
import * as richFormWorkflow from './workflows/rich-form';
import * as acmeStationsWorkflow from './workflows/acme-stations';
import { ACME_ADDONS_ROLE } from './workflows/acme-stations/forms';
import * as checklistConfirmationWorkflow from './workflows/checklist-confirmation';
import * as constraintFormWorkflow from './workflows/constraint-form';
import * as policyDocumentWorkflow from './workflows/policy-document';
import * as printRoutingWorkflow from './workflows/print-routing';
import * as orthoPipelineWorkflow from './workflows/ortho-pipeline';
import * as printerTwinWorkflow from './workflows/printer-twin';
import {
  PRINT_FARM_DIABETIC,
  PRINT_FARM_STANDARD,
  PRINTER_POOL_DIABETIC,
  PRINTER_POOL_STANDARD,
  PRINT_FARMER_DIABETIC,
  PRINT_FARMER_STANDARD,
} from './workflows/print-routing/types';
import {
  PRINT_ONBOARDER,
  PRINT_SERVICER,
  PRINTER_FLEET,
  PRINT_JOBS,
} from './workflows/printer-twin/types';

// ── Role constants ──────────────────────────────────────────────────────────

const REVIEWER = 'reviewer';
const ENGINEER = 'engineer';
const ADMIN = 'admin';
const SUPERADMIN = 'superadmin';
const GRINDER = 'grinder';
const GLUER = 'gluer';
const INTAKE_REVIEWER = 'intake-reviewer';
const CHECKLIST_OPERATOR = 'checklist-operator';
const QUALITY_REVIEWER = 'quality-reviewer';
const POLICY_DOCUMENT = 'policy-document';

const CERTIFIED_ROLES = [REVIEWER, ENGINEER, ADMIN];
const INVOCATION_ROLES = [SUPERADMIN, ENGINEER];

// ── Workflow configs ────────────────────────────────────────────────────────

const reviewContentConfig: LTWorkerConfig = {
  description: 'Content review — AI-powered moderation with human escalation for low-confidence results',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  roles: CERTIFIED_ROLES,
  toolTags: ['document-processing', 'vision', 'ocr', 'translation'],
  envelopeSchema: {
    data: { contentId: 'article-001', content: 'Content to review...', contentType: 'article' },
    metadata: { source: 'dashboard' },
  },
  resolverSchema: {
    approved: true,
    analysis: { confidence: 0.95, flags: [], summary: 'Manually reviewed and approved.' },
  },
};

const kitchenSinkConfig: LTWorkerConfig = {
  description: 'Kitchen sink — demonstrates sleep, signals, parallel activities, escalation, and every durable primitive',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: { name: 'World', mode: 'full' },
    metadata: { source: 'dashboard' },
  },
};

const basicEchoConfig: LTWorkerConfig = {
  description: 'Basic echo — sleeps, then echoes input with identity context. Minimal durable workflow.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  envelopeSchema: {
    data: { message: 'Hello, Long Tail!', sleepSeconds: 1 },
    metadata: { source: 'dashboard' },
  },
};

const basicSignalConfig: LTWorkerConfig = {
  description: 'Signal-based escalation — workflow stays running while waiting for human input via conditionLT',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  envelopeSchema: {
    data: { message: 'Deployment approval needed for v2.1.0', role: REVIEWER },
    metadata: { source: 'dashboard' },
  },
  resolverSchema: {
    properties: {
      approved: { type: 'boolean', default: false, description: 'Approve this deployment?' },
      notes: { type: 'string', default: '', description: 'Reviewer notes — visible to the workflow author' },
    },
  },
};

const efficientSignalConfig: LTWorkerConfig = {
  description: 'Signal-based escalation (efficient) — same human-in-the-loop as basicSignal, but the escalation row is written atomically in the workflow\'s Leg1 via condition(config): no separate create activity, no enrich. Invoke both and compare.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  envelopeSchema: {
    data: { message: 'Deployment approval needed for v2.1.0 (efficient path)', role: REVIEWER },
    metadata: { source: 'dashboard' },
  },
  resolverSchema: {
    properties: {
      approved: { type: 'boolean', default: false, description: 'Approve this deployment?' },
      notes: { type: 'string', default: '', description: 'Reviewer notes — visible to the workflow author' },
    },
  },
};

const checklistConfirmationConfig: LTWorkerConfig = {
  description: 'Checklist confirmation — runtime-driven dynamic checkboxes. Supply count (1–20, default 3); the workflow generates that many labelled steps in the escalation envelope and suspends. The dashboard renders them via the checklist widget. Reference example for x-lt-widget: checklist + x-lt-source.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: CHECKLIST_OPERATOR,
  envelopeSchema: {
    data: { count: 5 },
    metadata: { source: 'dashboard' },
  },
};

const constraintFormConfig: LTWorkerConfig = {
  description: 'Constraint form — reference example for every pre-submission guard: dynamic min/max (score floor from envelope.min_score, notes cap from envelope.max_notes_length), pattern (reference code), hidden required field (rejection_reason visible only when unapproved), and checklist widget with per-item required flags. Invoke with different min_score values to see dynamic bounds in action.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: QUALITY_REVIEWER,
  envelopeSchema: {
    data: {
      min_score: 60,
      max_notes_length: 500,
      checklist_items: [
        { id: 'documentation', label: 'All supporting documentation is attached', required: true },
        { id: 'contact_verified', label: 'Contact details have been verified', required: true },
        { id: 'photos', label: 'Before/after photos are present', required: false },
      ],
    },
    metadata: { source: 'dashboard' },
  },
};

const richFormConfig: LTWorkerConfig = {
  description: 'Rich form showcase — exercises every HITL form feature: dates, email, file upload, two-column layout, required fields, read-only, ordering. Reference example for the role-owned, versioned escalation interface (form_schema + resolver_schema, x-lt-bind).',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: INTAKE_REVIEWER,
  envelopeSchema: {
    data: { role: INTAKE_REVIEWER },
    metadata: { source: 'dashboard' },
  },
};

const acmeOrderConfig: LTWorkerConfig = {
  description: 'Acme order — the reference two-station manufacturing flow behind the perfect-form pair: a dictionary of order facts, one explicit Choose… decision, linear conditional reveals, pre-checked standard checks beside clickable custom work, and the rejection report. The acme-addons and acme-print-qa roles own the versioned forms.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: ACME_ADDONS_ROLE,
  envelopeSchema: {
    data: {
      po: 'ACME-1042',
      orderId: 'ord-8127',
      leftQuantity: 1,
      rightQuantity: 1,
      orthoticType: 'Functional',
      shoeSize: 'M10',
      material: 'polymax',
      certified: false,
      addons: [
        { id: 'wedge_medial', label: 'Wedge — medial, left — verified on the piece' },
        { id: 'met_pad', label: 'Met pad — standard — verified on the piece' },
      ],
    },
    metadata: { source: 'dashboard' },
  },
};

const policyDocumentConfig: LTWorkerConfig = {
  description: 'Policy document — a looped workflow that keeps ONE live policy escalation at a time; members revise it and each resolved revision is the audit trail. Reference example for the role-owned, versioned LIST view (list_schema).',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: POLICY_DOCUMENT,
  envelopeSchema: {
    data: { role: POLICY_DOCUMENT, title: 'Refund Policy', owner: 'Legal' },
    metadata: { source: 'dashboard' },
  },
};

const assemblyLineConfig: LTWorkerConfig = {
  description: 'Assembly line — orchestrates sequential stations with parallel child workflows and human escalation at each step',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: {
      productName: 'Widget A',
      stations: [
        { stationName: GRINDER, role: GRINDER, instructions: 'Grind widget to spec.' },
        { stationName: GLUER, role: GLUER, instructions: 'Bond components. Verify bond strength.' },
      ],
    },
    metadata: { source: 'dashboard' },
  },
};

const stepIteratorConfig: LTWorkerConfig = {
  description: 'Step iterator — walks a list of stations sequentially, spawning a child workstation for each step',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: {
      name: 'Widget B',
      steps: [
        { stationName: GRINDER, role: GRINDER, instructions: 'Grind widget to spec.' },
        { stationName: GLUER, role: GLUER, instructions: 'Bond components. Verify bond strength.' },
      ],
    },
    metadata: { source: 'dashboard' },
  },
};

const reverterConfig: LTWorkerConfig = {
  description: 'Reverter — like stepIterator but supports revert-on-rejection, stepping backwards through the assembly line',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: {
      name: 'Widget C',
      steps: [
        { stationName: GRINDER, role: GRINDER, instructions: 'Grind widget to spec.' },
        { stationName: GLUER, role: GLUER, instructions: 'Bond components. Verify bond strength.' },
      ],
    },
    metadata: { source: 'dashboard' },
  },
  resolverSchema: {
    approved: true,
    revertSteps: 0,
  },
};

const workstationConfig: LTWorkerConfig = {
  description: 'Workstation — child workflow for a single assembly station. Creates escalation, waits for human, signals parent.',
  invocable: false,
  defaultRole: GRINDER,
  roles: [...CERTIFIED_ROLES, GRINDER, GLUER],
  resolverSchema: {
    approved: true,
    station: GRINDER,
  },
};

const printOrderConfig: LTWorkerConfig = {
  description: 'Print order — the enqueuer. Writes the order\'s insole escalations as one origin group (capability + jeopardy facets in metadata), then parks until the print farm prints them all and wakes it. Diabetic orders route to an isolated role queue.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINT_FARM_STANDARD,
  roles: [PRINT_FARM_DIABETIC, PRINT_FARM_STANDARD],
  envelopeSchema: {
    data: {
      customerId: 'acme',
      diabetic: false,
      filament: 'pla',
      sizeClass: 'standard',
      approvedAt: 0,
      mustCompleteBy: 0,
      units: [{ side: 'L' }, { side: 'R' }, { side: 'L' }, { side: 'R' }],
    },
    metadata: { source: 'dashboard' },
  },
};

const printerConfig: LTWorkerConfig = {
  description: 'Printer — a durable workflow for one machine. It advertises itself as an escalation (ready/needs-filament), waits to be claimed, and advances its lifecycle on the run outcome: 3 runs between filament refills, end-of-life at 10 runs. The fleet\'s whole story is a query over these adverts.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINTER_POOL_STANDARD,
  roles: [PRINTER_POOL_DIABETIC, PRINTER_POOL_STANDARD],
  envelopeSchema: {
    data: { printerId: 'printer-1', diabetic: false, filament: 'pla', sizeClass: 'standard' },
    metadata: { source: 'dashboard' },
  },
};

const printBrokerConfig: LTWorkerConfig = {
  description: 'Print broker — the market maker, one singleton per fleet. Queries available printer adverts (supply), claims a printer and a matching complete order (demand) by capability in jeopardy order, prints in parallel, and resolves both. Throttles when idle and continueAsNew\'s to run durably forever.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINTER_POOL_STANDARD,
  roles: [PRINTER_POOL_DIABETIC, PRINTER_POOL_STANDARD, PRINT_FARM_DIABETIC, PRINT_FARM_STANDARD, PRINT_FARMER_DIABETIC, PRINT_FARMER_STANDARD],
  envelopeSchema: {
    data: { diabetic: false, tickSeconds: 1, idleTickSeconds: 5 },
    metadata: { source: 'dashboard' },
  },
};

const farmTechnicianConfig: LTWorkerConfig = {
  description: 'Farm technician — resolves printer needs-filament adverts ("added filament"), one singleton per fleet. The human stand-in; in production a dashboard operator claims and resolves these.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINTER_POOL_STANDARD,
  roles: [PRINTER_POOL_DIABETIC, PRINTER_POOL_STANDARD],
  envelopeSchema: {
    data: { diabetic: false, tickSeconds: 1, idleTickSeconds: 5 },
    metadata: { source: 'dashboard' },
  },
};

const farmInspectorConfig: LTWorkerConfig = {
  description: 'Farm inspector — the farmer. Signs off completed orders: resolves each order-done signoff escalation the broker raises after a print finishes, which wakes the order. The human stand-in; in production a dashboard operator inspects and signs off. One singleton per fleet.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINT_FARMER_STANDARD,
  roles: [PRINT_FARMER_DIABETIC, PRINT_FARMER_STANDARD],
  envelopeSchema: {
    data: { diabetic: false, tickSeconds: 1, idleTickSeconds: 5 },
    metadata: { source: 'dashboard' },
  },
};

const printShiftConfig: LTWorkerConfig = {
  description:
    'Print shift — the entry target. One click runs the whole farm end to end: it powers on the fleet (a near-EOL machine and a fresh one) plus the dispatcher, technician, and inspector, then feeds 12 orders through in three flavor waves — priority (a key-account order jumps the queue), a defect (the fixpoint loop reprints it), and a closing run that drives the refills and a retirement. The dispatcher works the floor until it is idle and the shift drains; idle machines are then powered down so nothing lingers. The whole run is a query over the escalation trail: what was intended, what happened, how long each print took, what was retried.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINT_FARM_STANDARD,
  roles: [
    PRINT_FARM_DIABETIC,
    PRINT_FARM_STANDARD,
    PRINTER_POOL_DIABETIC,
    PRINTER_POOL_STANDARD,
    PRINT_FARMER_DIABETIC,
    PRINT_FARMER_STANDARD,
  ],
  envelopeSchema: {
    data: { diabetic: false, idleTickSeconds: 1, maxIdleRuns: 12, waveGapSeconds: 1 },
    metadata: { source: 'dashboard' },
  },
};

const orthoPipelineConfig: LTWorkerConfig = {
  description:
    'Ortho pipeline — MCP-operable 8-stage manufacturing workflow (design → review → print → grind → glue → finish → qa → ship). Each stage creates an escalation atomically via conditionLT and suspends; resolving via ortho_complete_stage auto-resumes the next stage. Drive the full order lifecycle with AI or human operators.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  roles: [...CERTIFIED_ROLES, 'design', 'review', 'print', 'grind', 'glue', 'finish', 'qa', 'ship'],
  envelopeSchema: {
    data: { order_id: 'ORD-001', item_type: 'insole-standard' },
    metadata: { source: 'dashboard' },
  },
  // No resolverSchema — each stage role declares its own form_schema in seed-ortho.ts.
  // The dashboard cascade: metadata.form_schema > workflow resolver_schema > role form_schema.
  // For ortho, role form_schema is the source of truth, picked up automatically.
};

const printerTwinConfig: LTWorkerConfig = {
  description:
    'Printer twin — the digital twin of one REAL machine (Bambu Farm Manager), a poll-driven reconciliation loop that keeps a canonical mirror in sync with the physical printer. A print-servicer registers + binds the unboxed machine, then the twin advertises availability, prints jobs the broker hands off, and reconciles each print to a poll-confirmed terminal (poll is ground truth — offline/stop/reset have no webhook). Every divergence that needs a decision — change filament, inspect a failure, investigate an offline machine, retire — surfaces as an escalation the twin waits on. The hot loop runs inside a proxyActivity (no durable sleep) and the twin continues via startChild links.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINT_SERVICER,
  roles: [PRINT_ONBOARDER, PRINT_SERVICER, PRINTER_FLEET],
  // Registered, never certified — configs with roles derive certified=true otherwise.
  certified: false,
  envelopeSchema: {
    data: { printerId: 'printer-01', operatorId: '' },
    metadata: { source: 'dashboard' },
  },
};

const twinOrderConfig: LTWorkerConfig = {
  description:
    'Twin order — demand for the twin fleet. Writes one print-job escalation per unit as one origin group (filament + required capabilities as facets, a signed gcode URL per unit), then parks until the broker settles the whole set and reports every unit\'s outcome.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINT_JOBS,
  roles: [PRINT_JOBS],
  certified: false,
  envelopeSchema: {
    data: {
      filament: 'pla',
      require: { xl: false, pdac: false, soft: false },
      units: [{ gcodeUrl: 'https://example.com/unit-0.gcode' }, { gcodeUrl: 'https://example.com/unit-1.gcode' }],
      operatorId: '',
    },
    metadata: { source: 'dashboard' },
  },
};

const twinBrokerConfig: LTWorkerConfig = {
  description:
    'Twin broker — the market maker at the physical boundary, one singleton. Claims demand sized to ready supply, locks each order\'s printer SET all-or-nothing, and hands each twin its job by resolving its advert. The twin itself drives the physical print (poll-reconciled to a terminal) and reports back; the broker harvests those reports and settles the order. Throttles when idle and continueAsNew\'s to run durably.',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: PRINTER_FLEET,
  roles: [PRINTER_FLEET, PRINT_JOBS],
  certified: false,
  envelopeSchema: {
    data: { brokerId: '', tickSeconds: 1, idleTickSeconds: 5, maxIdleRuns: 60 },
    metadata: { source: 'dashboard' },
  },
};

// ── Worker exports ──────────────────────────────────────────────────────────

/**
 * Example workers that ship with Long Tail.
 * Each worker's `config` block auto-seeds its dashboard profile at startup.
 * Enable via `examples: true` in the start config.
 */
export const exampleWorkers = [
  { taskQueue: 'long-tail-examples', workflow: reviewContentWorkflow.reviewContent, config: reviewContentConfig },
  { taskQueue: 'long-tail-examples', workflow: kitchenSinkWorkflow.kitchenSink, config: kitchenSinkConfig },
  { taskQueue: 'long-tail-examples', workflow: basicEchoWorkflow.basicEcho, config: basicEchoConfig },
  { taskQueue: 'long-tail-examples', workflow: assemblyLineWorkflow.assemblyLine, config: assemblyLineConfig },
  { taskQueue: 'long-tail-examples', workflow: workstationWorkflow.workstation, config: workstationConfig },
  { taskQueue: 'long-tail-examples', workflow: stepIteratorWorkflow.stepIterator, config: stepIteratorConfig },
  { taskQueue: 'long-tail-examples', workflow: reverterWorkflow.reverter, config: reverterConfig },
  { taskQueue: 'long-tail-examples', workflow: basicSignalWorkflow.basicSignal, config: basicSignalConfig },
  { taskQueue: 'long-tail-examples', workflow: efficientSignalWorkflow.efficientSignal, config: efficientSignalConfig },
  { taskQueue: 'long-tail-examples', workflow: checklistConfirmationWorkflow.checklistConfirmation, config: checklistConfirmationConfig },
  { taskQueue: 'long-tail-examples', workflow: constraintFormWorkflow.constraintForm, config: constraintFormConfig },
  { taskQueue: 'long-tail-examples', workflow: richFormWorkflow.richForm, config: richFormConfig },
  { taskQueue: 'long-tail-examples', workflow: acmeStationsWorkflow.acmeOrder, config: acmeOrderConfig },
  { taskQueue: 'long-tail-examples', workflow: policyDocumentWorkflow.policyDocument, config: policyDocumentConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printOrder, config: printOrderConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printer, config: printerConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printBroker, config: printBrokerConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.farmTechnician, config: farmTechnicianConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.farmInspector, config: farmInspectorConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printShift, config: printShiftConfig },
  { taskQueue: 'long-tail-examples', workflow: orthoPipelineWorkflow.orthoPipeline, config: orthoPipelineConfig },
  { taskQueue: 'long-tail-examples', workflow: printerTwinWorkflow.printerTwin, config: printerTwinConfig },
  { taskQueue: 'long-tail-examples', workflow: printerTwinWorkflow.twinOrder, config: twinOrderConfig },
  { taskQueue: 'long-tail-examples', workflow: printerTwinWorkflow.twinBroker, config: twinBrokerConfig },
];
