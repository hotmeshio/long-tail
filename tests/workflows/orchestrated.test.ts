import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';
import * as reviewContentWorkflow from '../../examples/workflows/review-content';
import * as reviewContentOrchestrator from '../../examples/workflows/review-content/orchestrator';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import type { LTReturn } from '../../types';

const { Connection, Client, Worker } = Durable;

const LEAF_QUEUE = 'long-tail';
const ORCH_QUEUE = 'test-orch';
// Must match the default in orchestrator/index.ts so proxyActivities routes correctly
const ACTIVITY_QUEUE = 'lt-interceptor';

describe('orchestrated workflows (executeLT)', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Seed config for leaf + orchestrator workflows
    await configService.upsertWorkflowConfig({
      workflow_type: 'reviewContent',
      is_lt: true,
      is_container: false,
      invocable: false,
      task_queue: LEAF_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: ['reviewer'],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });
    await configService.upsertWorkflowConfig({
      workflow_type: 'reviewContentOrchestrator',
      is_lt: false,
      is_container: true,
      invocable: false,
      task_queue: ORCH_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: [],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    // Register shared activity worker
    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    // Register interceptor
    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    Durable.registerInterceptor(ltInterceptor);

    const ltActivityInterceptor = createLTActivityInterceptor();
    Durable.registerActivityInterceptor(ltActivityInterceptor);

    // Register LEAF workflow worker
    const leafWorker = await Worker.create({
      connection,
      taskQueue: LEAF_QUEUE,
      workflow: reviewContentWorkflow.reviewContent,
    });
    await leafWorker.run();

    // Register ORCHESTRATOR workflow worker
    const orchWorker = await Worker.create({
      connection,
      taskQueue: ORCH_QUEUE,
      workflow: reviewContentOrchestrator.reviewContentOrchestrator,
    });
    await orchWorker.run();

    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── executeLT: auto-approve creates task + returns result ───────────────────

  it('should auto-approve via orchestrator and create task record', async () => {
    const workflowId = `test-orch-approve-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'orch-1',
          content: 'Good content that auto-approves via orchestrator.',
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'reviewContentOrchestrator',
      workflowId,
      expire: 120,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);

    // Verify task was created by executeLT with workflow_type 'reviewContent'
    await sleepFor(500);
    const { tasks } = await taskService.listTasks({ workflow_type: 'reviewContent' });
    const task = tasks.find(t => t.status === 'completed' && t.workflow_type === 'reviewContent');
    expect(task).toBeTruthy();
    expect(task!.status).toBe('completed');
  }, 30_000);

  // ── executeLT: escalation ends child, resolve starts new child ──────────────

  it('should escalate via orchestrator and resolve via new workflow', async () => {
    const orchWorkflowId = `test-orch-escalate-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'orch-esc-1',
          content: 'REVIEW_ME needs human review via orchestrator',
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'reviewContentOrchestrator',
      workflowId: orchWorkflowId,
      expire: 180,
    });

    // Poll for the child task to reach needs_intervention (created by executeLT)
    let childTask: Awaited<ReturnType<typeof taskService.getTask>> = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { tasks } = await taskService.listTasks({
        parent_workflow_id: orchWorkflowId,
        status: 'needs_intervention',
      });
      if (tasks.length > 0) { childTask = tasks[0]; break; }
      await sleepFor(1_000);
    }
    expect(childTask).toBeTruthy();
    expect(childTask!.workflow_id).toBeTruthy();

    // Poll for escalation — ltCreateEscalation runs asynchronously after ltEscalateTask
    let escalations: Awaited<ReturnType<typeof escalationService.getEscalationsByWorkflowId>> = [];
    const escDeadline = Date.now() + 10_000;
    while (Date.now() < escDeadline) {
      escalations = await escalationService.getEscalationsByWorkflowId(childTask!.workflow_id);
      if (escalations.length > 0) break;
      await sleepFor(500);
    }
    expect(escalations.length).toBeGreaterThan(0);
    const esc = escalations[0];
    expect(esc.task_queue).toBeTruthy();
    expect(esc.workflow_type).toBe('reviewContent');

    // Resolve by starting a new workflow (interceptor resolves escalation + signals orchestrator)
    await resolveEscalation(esc.id, {
      contentId: 'orch-esc-1',
      approved: true,
      humanNote: 'Reviewed via orchestrator path',
    });

    // Orchestrator should complete — the new child signals back
    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);
    expect(result.data.humanNote).toBe('Reviewed via orchestrator path');

    // Verify the interceptor resolved the escalation record
    await sleepFor(500);
    const resolvedEsc = await escalationService.getEscalation(esc.id);
    expect(resolvedEsc!.status).toBe('resolved');
    expect(resolvedEsc!.resolver_payload).toBeTruthy();
  }, 30_000);

  // ── executeLT: task record completed after escalation resolve ───────────────

  it('should complete the task record after escalation is resolved', async () => {
    const orchWorkflowId = `test-orch-complete-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'orch-complete-1',
          content: 'REVIEW_ME check task completion',
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'reviewContentOrchestrator',
      workflowId: orchWorkflowId,
      expire: 180,
    });

    // Poll for child task to reach needs_intervention
    let childTask: Awaited<ReturnType<typeof taskService.getTask>> = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { tasks } = await taskService.listTasks({
        parent_workflow_id: orchWorkflowId,
        status: 'needs_intervention',
      });
      if (tasks.length > 0) { childTask = tasks[0]; break; }
      await sleepFor(1_000);
    }
    expect(childTask).toBeTruthy();

    // Poll for escalation — ltCreateEscalation runs asynchronously after ltEscalateTask
    let escalations: Awaited<ReturnType<typeof escalationService.getEscalationsByWorkflowId>> = [];
    const escDeadline2 = Date.now() + 10_000;
    while (Date.now() < escDeadline2) {
      escalations = await escalationService.getEscalationsByWorkflowId(childTask!.workflow_id);
      if (escalations.length > 0) break;
      await sleepFor(500);
    }
    expect(escalations.length).toBeGreaterThan(0);

    await resolveEscalation(escalations[0].id, {
      contentId: 'orch-complete-1',
      approved: true,
    });

    await handle.result();
    await sleepFor(500);

    // Verify the task is now completed (orchestrator completes it when signal returns)
    const task = await taskService.getTaskByWorkflowId(childTask!.workflow_id);
    expect(task).toBeTruthy();
    expect(task!.status).toBe('completed');
    expect(task!.data).toBeTruthy();
  }, 30_000);

  // ── Workflow milestones: persisted to task record via orchestrator ────────────

  it('should persist workflow milestones to the task record', async () => {
    const workflowId = `test-orch-milestones-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'milestone-1',
          content: 'Good content for milestone persistence test.',
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'reviewContentOrchestrator',
      workflowId,
      expire: 120,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);

    // Find the child task created by executeLT
    await sleepFor(500);
    const { tasks } = await taskService.listTasks({ workflow_type: 'reviewContent' });
    const task = tasks.find(t => {
      if (t.status !== 'completed' || !t.data) return false;
      const parsed = JSON.parse(t.data);
      return parsed?.contentId === 'milestone-1';
    });
    expect(task).toBeTruthy();

    // The orchestrator persists milestones from the child workflow's return value
    expect(task!.milestones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'llm', value: 'content_analysis' }),
      ]),
    );
  }, 30_000);

  // ── Orchestrator pass-through: interceptor skips orchestrator workflows ─────

  it('should pass orchestrator workflows through without interception', async () => {
    // The orchestrator itself should not get a task record
    // (only the child workflow gets one via executeLT)
    const orchWorkflowId = `test-orch-passthrough-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'passthrough-1',
          content: 'Good content for pass-through test.',
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'reviewContentOrchestrator',
      workflowId: orchWorkflowId,
      expire: 60,
    });

    await handle.result();
    await sleepFor(500);

    // The orchestrator workflow ID should NOT have a task
    // (only the child workflow has one)
    const orchTask = await taskService.getTaskByWorkflowId(orchWorkflowId);
    expect(orchTask).toBeNull();
  }, 30_000);
});
