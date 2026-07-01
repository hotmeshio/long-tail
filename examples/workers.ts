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
import * as printRoutingWorkflow from './workflows/print-routing';
import * as orthoPipelineWorkflow from './workflows/ortho-pipeline';
import {
  PRINT_FARM_DIABETIC,
  PRINT_FARM_STANDARD,
  PRINTER_POOL_DIABETIC,
  PRINTER_POOL_STANDARD,
  PRINT_FARMER_DIABETIC,
  PRINT_FARMER_STANDARD,
} from './workflows/print-routing/types';

// ── Role constants ──────────────────────────────────────────────────────────

const REVIEWER = 'reviewer';
const ENGINEER = 'engineer';
const ADMIN = 'admin';
const SUPERADMIN = 'superadmin';
const GRINDER = 'grinder';
const GLUER = 'gluer';

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

const richFormConfig: LTWorkerConfig = {
  description: 'Rich form showcase — exercises every HITL form feature: dates, email, file upload, two-column layout, required fields, read-only, ordering',
  invocable: true,
  invocationRoles: INVOCATION_ROLES,
  defaultRole: REVIEWER,
  envelopeSchema: {
    data: { role: REVIEWER },
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
  { taskQueue: 'long-tail-examples', workflow: richFormWorkflow.richForm, config: richFormConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printOrder, config: printOrderConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printer, config: printerConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printBroker, config: printBrokerConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.farmTechnician, config: farmTechnicianConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.farmInspector, config: farmInspectorConfig },
  { taskQueue: 'long-tail-examples', workflow: printRoutingWorkflow.printShift, config: printShiftConfig },
  { taskQueue: 'long-tail-examples', workflow: orthoPipelineWorkflow.orthoPipeline, config: orthoPipelineConfig },
];
