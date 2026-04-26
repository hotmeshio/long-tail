/**
 * Assembly Line — integration tests for durable orchestrator examples.
 *
 * Exercises three workflows end-to-end through the HTTP API:
 *
 *   1. Assembly Line — explicit parent→child orchestration: grinder → gluer
 *   2. Step Iterator — generic data-driven loop: grinder → gluer
 *   3. Reverter — loop with QA revert: grinder → gluer → finishing (reject) → gluer → finishing (approve)
 *
 * The tests register workflow configs, invoke the workflows, then
 * walk the escalation lifecycle as superadmin (filtering by role).
 *
 * Requires: docker compose up -d --build (app + Postgres + Redis)
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { ApiClient, poll, log } from './helpers';

const PASSWORD = 'l0ngt@1l';
const TASK_QUEUE = 'long-tail-examples';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Find a pending escalation for the given role whose workflow_id contains the marker. */
async function findEscalation(
  api: ApiClient,
  role: string,
  workflowIdMarker: string,
  timeoutMs = 30_000,
): Promise<{ id: string; workflow_id: string; description: string }> {
  return poll(
    `pending escalation for role=${role} matching "${workflowIdMarker}"`,
    async () => {
      const { escalations } = await api.listEscalations({ role, status: 'pending' });
      return escalations.find(
        (e: any) => e.workflow_id?.includes(workflowIdMarker) && e.status === 'pending',
      );
    },
    timeoutMs,
    2_000,
  );
}

/** Claim and resolve an escalation, returning the signal response. */
async function claimAndResolve(
  api: ApiClient,
  escalationId: string,
  resolverPayload: Record<string, any>,
): Promise<any> {
  await api.claimEscalation(escalationId);
  return api.resolveEscalation(escalationId, resolverPayload);
}

/** Poll the workflow result endpoint until it returns data. */
async function waitForResult(
  api: ApiClient,
  workflowId: string,
  timeoutMs = 30_000,
): Promise<any> {
  return poll(
    `workflow result for ${workflowId}`,
    async () => {
      try {
        const result = await api.getWorkflowResult(workflowId);
        if (result?.result?.type === 'return') return result;
        return null;
      } catch {
        return null;
      }
    },
    timeoutMs,
    2_000,
  );
}

/** Register a workflow config and invoke it, returning the workflowId. */
async function registerAndInvoke(
  api: ApiClient,
  workflowType: string,
  data: Record<string, any>,
): Promise<string> {
  // Create config (idempotent via PUT)
  await api.put(`/api/workflows/${workflowType}/config`, {
    invocable: true,
    task_queue: TASK_QUEUE,
    default_role: 'reviewer',
  });

  const { data: result } = await api.post(`/api/workflows/${workflowType}/invoke`, { data });
  return result.workflowId;
}

// ── Client ──────────────────────────────────────────────────────────────────

let api: ApiClient;

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', PASSWORD);
  log('setup', 'superadmin logged in');
});

// ── Test 1: Assembly Line ───────────────────────────────────────────────────

describe('Assembly Line', () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await registerAndInvoke(api, 'assemblyLine', {
      productName: 'Widget A',
      stations: [
        { stationName: 'grinder', role: 'grinder', instructions: 'Grind widget to spec. Inspect surface.' },
        { stationName: 'gluer', role: 'gluer', instructions: 'Bond components. Verify bond strength.' },
      ],
    });
    log('assemblyLine', `started: ${workflowId}`);
  });

  it('grinder approves station 1', async () => {
    const esc = await findEscalation(api, 'grinder', workflowId);
    log('assemblyLine', `grinder escalation: ${esc.id}`);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'Surface finish is clean',
    });

    expect(result.signaled).toBe(true);
  });

  it('gluer approves station 2', async () => {
    const esc = await findEscalation(api, 'gluer', workflowId);
    log('assemblyLine', `gluer escalation: ${esc.id}`);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'Bond strength verified',
    });

    expect(result.signaled).toBe(true);
  });

  it('workflow completes with both station results', async () => {
    const { result } = await waitForResult(api, workflowId);

    expect(result.type).toBe('return');
    expect(result.data.productName).toBe('Widget A');
    expect(result.data.stations).toHaveLength(2);

    expect(result.data.stations[0].stationName).toBe('grinder');
    expect(result.data.stations[0].resolution.approved).toBe(true);

    expect(result.data.stations[1].stationName).toBe('gluer');
    expect(result.data.stations[1].resolution.approved).toBe(true);

    expect(result.data.completedAt).toBeTruthy();
    log('assemblyLine', `completed: ${result.data.completedAt}`);
  });
});

// ── Test 2: Step Iterator ───────────────────────────────────────────────────

describe('Step Iterator', () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await registerAndInvoke(api, 'stepIterator', {
      name: 'Widget B — Dynamic Pipeline',
      steps: [
        { stationName: 'grinder', role: 'grinder', instructions: 'Grind housing. Check tolerances.' },
        { stationName: 'gluer', role: 'gluer', instructions: 'Bond panels. Pressure test.' },
      ],
    });
    log('stepIterator', `started: ${workflowId}`);
  });

  it('grinder approves station 1', async () => {
    const esc = await findEscalation(api, 'grinder', workflowId);
    log('stepIterator', `grinder escalation: ${esc.id}`);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'Surface within tolerance',
    });

    expect(result.signaled).toBe(true);
  });

  it('gluer approves station 2', async () => {
    const esc = await findEscalation(api, 'gluer', workflowId);
    log('stepIterator', `gluer escalation: ${esc.id}`);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'Bond strength verified',
    });

    expect(result.signaled).toBe(true);
  });

  it('workflow completes with both station results', async () => {
    const { result } = await waitForResult(api, workflowId);

    expect(result.type).toBe('return');
    expect(result.data.name).toBe('Widget B — Dynamic Pipeline');
    expect(result.data.totalSteps).toBe(2);
    expect(result.data.steps).toHaveLength(2);

    expect(result.data.steps[0].stationName).toBe('grinder');
    expect(result.data.steps[0].resolution.approved).toBe(true);

    expect(result.data.steps[1].stationName).toBe('gluer');
    expect(result.data.steps[1].resolution.approved).toBe(true);

    expect(result.data.completedAt).toBeTruthy();
    log('stepIterator', `completed: ${result.data.completedAt}`);
  });
});

// ── Test 3: Reverter ────────────────────────────────────────────────────────

describe('Reverter', () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await registerAndInvoke(api, 'reverter', {
      name: 'Widget C — QA Pipeline',
      steps: [
        { stationName: 'grinder', role: 'grinder', instructions: 'Grind frame. Approve when smooth.' },
        { stationName: 'gluer', role: 'gluer', instructions: 'Bond panels. Approve or revert.' },
        { stationName: 'finishing', role: 'finishing', instructions: 'Final QA. Approve to ship or revert.' },
      ],
    });
    log('reverter', `started: ${workflowId}`);
  });

  it('grinder approves step 0', async () => {
    const esc = await findEscalation(api, 'grinder', workflowId);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'Surface smooth',
    });

    expect(result.signaled).toBe(true);
  });

  it('gluer approves step 1', async () => {
    const esc = await findEscalation(api, 'gluer', workflowId);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'Bond solid',
    });

    expect(result.signaled).toBe(true);
  });

  it('finishing rejects and reverts 1 step back to gluer', async () => {
    const esc = await findEscalation(api, 'finishing', workflowId);

    const result = await claimAndResolve(api, esc.id, {
      approved: false,
      revertSteps: 1,
      reason: 'Adhesive smear on panel B',
    });

    expect(result.signaled).toBe(true);
  });

  it('gluer re-approves after revert', async () => {
    const esc = await findEscalation(api, 'gluer', workflowId);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'Re-bonded panel B, adhesive clean',
    });

    expect(result.signaled).toBe(true);
  });

  it('finishing approves on second pass', async () => {
    const esc = await findEscalation(api, 'finishing', workflowId);

    const result = await claimAndResolve(api, esc.id, {
      approved: true,
      notes: 'QA passed — ship it',
    });

    expect(result.signaled).toBe(true);
  });

  it('workflow completes with full history including revert', async () => {
    const { result } = await waitForResult(api, workflowId);

    expect(result.type).toBe('return');
    expect(result.data.name).toBe('Widget C — QA Pipeline');
    expect(result.data.totalSteps).toBe(3);
    expect(result.data.totalAttempts).toBe(5);

    // Final approved results (one per step)
    expect(result.data.steps).toHaveLength(3);
    expect(result.data.steps[0].stationName).toBe('grinder');
    expect(result.data.steps[0].resolution.approved).toBe(true);
    expect(result.data.steps[1].stationName).toBe('gluer');
    expect(result.data.steps[1].resolution.notes).toBe('Re-bonded panel B, adhesive clean');
    expect(result.data.steps[2].stationName).toBe('finishing');
    expect(result.data.steps[2].resolution.approved).toBe(true);

    // Full history includes the revert event
    expect(result.data.history).toHaveLength(5);

    expect(result.data.history[0].type).toBe('advance');
    expect(result.data.history[0].stationName).toBe('grinder');

    expect(result.data.history[1].type).toBe('advance');
    expect(result.data.history[1].stationName).toBe('gluer');

    expect(result.data.history[2].type).toBe('revert');
    expect(result.data.history[2].stationName).toBe('finishing');
    expect(result.data.history[2].resolution.revertSteps).toBe(1);
    expect(result.data.history[2].resolution.reason).toBe('Adhesive smear on panel B');

    expect(result.data.history[3].type).toBe('advance');
    expect(result.data.history[3].stationName).toBe('gluer');

    expect(result.data.history[4].type).toBe('advance');
    expect(result.data.history[4].stationName).toBe('finishing');

    expect(result.data.completedAt).toBeTruthy();
    log('reverter', `completed: ${result.data.completedAt}`);
  });
});
