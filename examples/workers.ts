import type { LTWorkerConfig } from '../types/startup';

import * as reviewContentWorkflow from './workflows/review-content';
import * as kitchenSinkWorkflow from './workflows/kitchen-sink';
import * as basicEchoWorkflow from './workflows/basic-echo';
import * as assemblyLineWorkflow from './workflows/assembly-line';
import * as workstationWorkflow from './workflows/assembly-line/worker';
import * as stepIteratorWorkflow from './workflows/assembly-line/iterator';
import * as reverterWorkflow from './workflows/assembly-line/reverter';
import * as basicSignalWorkflow from './workflows/basic-signal';

// ── Shared role sets ────────────────────────────────────────────────────────

const CERTIFIED_ROLES = ['reviewer', 'engineer', 'admin'];

// ── Workflow configs ────────────────────────────────────────────────────────

const reviewContentConfig: LTWorkerConfig = {
  description: 'Content review — AI-powered moderation with human escalation for low-confidence results',
  invocable: true,
  defaultRole: 'reviewer',
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
  defaultRole: 'reviewer',
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: { name: 'World', mode: 'full' },
    metadata: { source: 'dashboard' },
  },
};

const basicEchoConfig: LTWorkerConfig = {
  description: 'Basic echo — sleeps, then echoes input with identity context. Minimal durable workflow.',
  invocable: true,
  envelopeSchema: {
    data: { message: 'Hello, Long Tail!', sleepSeconds: 1 },
    metadata: { source: 'dashboard' },
  },
};

const basicSignalConfig: LTWorkerConfig = {
  description: 'Signal-based escalation — workflow stays running while waiting for human input via conditionLT',
  invocable: true,
  defaultRole: 'reviewer',
  envelopeSchema: {
    data: { message: 'Deployment approval needed for v2.1.0', role: 'reviewer' },
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
  defaultRole: 'reviewer',
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: {
      productName: 'Widget A',
      stations: [
        { stationName: 'grinder', role: 'grinder', instructions: 'Grind widget to spec.' },
        { stationName: 'gluer', role: 'gluer', instructions: 'Bond components. Verify bond strength.' },
      ],
    },
    metadata: { source: 'dashboard' },
  },
};

const stepIteratorConfig: LTWorkerConfig = {
  description: 'Step iterator — walks a list of stations sequentially, spawning a child workstation for each step',
  invocable: true,
  defaultRole: 'reviewer',
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: {
      name: 'Widget B',
      steps: [
        { stationName: 'grinder', role: 'grinder', instructions: 'Grind widget to spec.' },
        { stationName: 'gluer', role: 'gluer', instructions: 'Bond components. Verify bond strength.' },
      ],
    },
    metadata: { source: 'dashboard' },
  },
};

const reverterConfig: LTWorkerConfig = {
  description: 'Reverter — like stepIterator but supports revert-on-rejection, stepping backwards through the assembly line',
  invocable: true,
  defaultRole: 'reviewer',
  roles: CERTIFIED_ROLES,
  envelopeSchema: {
    data: {
      name: 'Widget C',
      steps: [
        { stationName: 'grinder', role: 'grinder', instructions: 'Grind widget to spec.' },
        { stationName: 'gluer', role: 'gluer', instructions: 'Bond components. Verify bond strength.' },
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
  defaultRole: 'grinder',
  roles: [...CERTIFIED_ROLES, 'grinder', 'gluer'],
  resolverSchema: {
    approved: true,
    station: 'grinder',
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
