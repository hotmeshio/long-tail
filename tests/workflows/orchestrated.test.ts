import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../lib/db/migrate';
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';
import * as reviewContentWorkflow from '../../examples/workflows/review-content';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import type { LTReturn } from '../../types';

const { Connection, Client, Worker } = Durable;

const LEAF_QUEUE = 'long-tail-examples';
// Must match the default in orchestrator/index.ts so proxyActivities routes correctly
const ACTIVITY_QUEUE = 'lt-interceptor';

describe('direct workflow invocation with LT treatment', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Seed config for reviewContent workflow
    await configService.upsertWorkflowConfig({
      workflow_type: 'reviewContent',
      invocable: false,
      task_queue: LEAF_QUEUE,
      default_role: 'reviewer',
      description: null,
      roles: ['reviewer'],
      invocation_roles: [],
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
    Durable.registerInboundInterceptor(ltInterceptor);

    const ltActivityInterceptor = createLTActivityInterceptor();
    Durable.registerOutboundInterceptor(ltActivityInterceptor);

    // Register reviewContent workflow worker
    const leafWorker = await Worker.create({
      connection,
      taskQueue: LEAF_QUEUE,
      workflow: reviewContentWorkflow.reviewContent,
    });
    await leafWorker.run();

    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearOutboundInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Direct invocation: auto-approve creates task + returns result ──────────

  it('should auto-approve and create task record when started directly', async () => {
    const workflowId = `test-direct-approve-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'direct-1',
          content: 'Good content that auto-approves directly.',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);

    // Verify task was created by the interceptor with workflow_type 'reviewContent'
    await sleepFor(500);
    const { tasks } = await taskService.listTasks({ workflow_type: 'reviewContent' });
    const task = tasks.find(t => t.status === 'completed' && t.workflow_type === 'reviewContent');
    expect(task).toBeTruthy();
    expect(task!.status).toBe('completed');
  }, 30_000);

  // ── Direct invocation: escalation + resolution via new workflow ────────────

  it('should escalate and resolve via new workflow when started directly', async () => {
    const workflowId = `test-direct-escalate-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'direct-esc-1',
          content: 'REVIEW_ME needs human review directly',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 180,
    });

    // Poll for the task to reach needs_intervention
    let task: Awaited<ReturnType<typeof taskService.getTask>> = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { tasks } = await taskService.listTasks({
        workflow_type: 'reviewContent',
        status: 'needs_intervention',
      });
      const match = tasks.find(t => t.workflow_id === workflowId);
      if (match) { task = match; break; }
      await sleepFor(1_000);
    }
    expect(task).toBeTruthy();
    expect(task!.workflow_id).toBeTruthy();

    // Poll for escalation
    let escalations: Awaited<ReturnType<typeof escalationService.getEscalationsByWorkflowId>> = [];
    const escDeadline = Date.now() + 10_000;
    while (Date.now() < escDeadline) {
      escalations = await escalationService.getEscalationsByWorkflowId(task!.workflow_id);
      if (escalations.length > 0) break;
      await sleepFor(500);
    }
    expect(escalations.length).toBeGreaterThan(0);
    const esc = escalations[0];
    expect(esc.task_queue).toBeTruthy();
    expect(esc.workflow_type).toBe('reviewContent');

    // Resolve by starting a new workflow (interceptor resolves escalation)
    await resolveEscalation(esc.id, {
      contentId: 'direct-esc-1',
      approved: true,
      humanNote: 'Reviewed via direct path',
    });

    // The original workflow should have ended with escalation; the new workflow completes
    await sleepFor(500);

    // Verify the interceptor resolved the escalation record
    const resolvedEsc = await escalationService.getEscalation(esc.id);
    expect(resolvedEsc!.status).toBe('resolved');
    expect(resolvedEsc!.resolver_payload).toBeTruthy();
  }, 30_000);

  // ── Direct invocation: task record completed after escalation resolve ──────

  it('should complete the task record after escalation is resolved', async () => {
    const workflowId = `test-direct-complete-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'direct-complete-1',
          content: 'REVIEW_ME check task completion',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 180,
    });

    // Poll for task to reach needs_intervention
    let task: Awaited<ReturnType<typeof taskService.getTask>> = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { tasks } = await taskService.listTasks({
        workflow_type: 'reviewContent',
        status: 'needs_intervention',
      });
      const match = tasks.find(t => t.workflow_id === workflowId);
      if (match) { task = match; break; }
      await sleepFor(1_000);
    }
    expect(task).toBeTruthy();

    // Poll for escalation
    let escalations: Awaited<ReturnType<typeof escalationService.getEscalationsByWorkflowId>> = [];
    const escDeadline2 = Date.now() + 10_000;
    while (Date.now() < escDeadline2) {
      escalations = await escalationService.getEscalationsByWorkflowId(task!.workflow_id);
      if (escalations.length > 0) break;
      await sleepFor(500);
    }
    expect(escalations.length).toBeGreaterThan(0);

    await resolveEscalation(escalations[0].id, {
      contentId: 'direct-complete-1',
      approved: true,
    });

    await sleepFor(1500);

    // Verify the resolution workflow created a completed task
    // (the original task stays needs_intervention; the resolution creates a new completed task)
    const { tasks: completedTasks } = await taskService.listTasks({
      workflow_type: 'reviewContent',
      status: 'completed',
    });
    const completed = completedTasks.find(t => {
      if (!t.data) return false;
      const parsed = JSON.parse(t.data);
      return parsed?.contentId === 'direct-complete-1';
    });
    expect(completed).toBeTruthy();
    expect(completed!.status).toBe('completed');
  }, 30_000);

  // ── Workflow milestones: persisted to task record ──────────────────────────

  it('should persist workflow milestones to the task record', async () => {
    const workflowId = `test-direct-milestones-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'milestone-1',
          content: 'Good content for milestone persistence test.',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);

    // Find the task created by the interceptor
    await sleepFor(500);
    const { tasks } = await taskService.listTasks({ workflow_type: 'reviewContent' });
    const task = tasks.find(t => {
      if (t.status !== 'completed' || !t.data) return false;
      const parsed = JSON.parse(t.data);
      return parsed?.contentId === 'milestone-1';
    });
    expect(task).toBeTruthy();

    // The interceptor persists milestones from the workflow's return value
    expect(task!.milestones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'llm', value: 'content_analysis' }),
      ]),
    );
  }, 30_000);
});
