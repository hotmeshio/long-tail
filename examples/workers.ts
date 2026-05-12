import type { LTWorkerConfig } from '../types/startup';

import * as reviewContentWorkflow from './workflows/review-content';
import * as kitchenSinkWorkflow from './workflows/kitchen-sink';
import * as basicEchoWorkflow from './workflows/basic-echo';
import * as assemblyLineWorkflow from './workflows/assembly-line';
import * as workstationWorkflow from './workflows/assembly-line/worker';
import * as stepIteratorWorkflow from './workflows/assembly-line/iterator';
import * as reverterWorkflow from './workflows/assembly-line/reverter';
import * as basicSignalWorkflow from './workflows/basic-signal';

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
    metadata: { certified: false, source: 'dashboard' },
  },
  resolverSchema: {
    properties: {
      approved: { type: 'boolean', default: false, description: 'Approve this deployment?' },
      notes: { type: 'string', default: '', description: 'Reviewer notes — visible to the workflow author' },
    },
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
];
