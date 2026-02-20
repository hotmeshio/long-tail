import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { MemFlow } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as reviewContentWorkflow from '../../workflows/review-content';
import * as reviewContentOrchestrator from '../../workflows/review-content/orchestrator';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import type { LTReturn } from '../../types';

const { Connection, Client, Worker } = MemFlow;

const LEAF_QUEUE = 'long-tail';
const ORCH_QUEUE = 'test-orch';
// Must match the default in lib/executeLT.ts so proxyActivities routes correctly
const ACTIVITY_QUEUE = 'lt-interceptor';

describe('orchestrated workflows (executeLT)', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
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
      task_queue: LEAF_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: ['reviewer'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });
    await configService.upsertWorkflowConfig({
      workflow_type: 'reviewContentOrchestrator',
      is_lt: false,
      is_container: true,
      task_queue: ORCH_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    // Register shared activity worker
    await MemFlow.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    // Register interceptor
    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    MemFlow.registerInterceptor(ltInterceptor);

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
  }, 60_000);

  afterAll(async () => {
    MemFlow.clearInterceptors();
    await sleepFor(1500);
    await MemFlow.shutdown();
  }, 10_000);

  // ── executeLT: auto-approve creates task + returns result ───────────────────

  it('should auto-approve via orchestrator and create task record', async () => {
    const workflowId = `test-orch-approve-${MemFlow.guid()}`;

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
  }, 45_000);

  // ── executeLT: escalation creates task + escalation, resumes on signal ──────

  it('should escalate via orchestrator and resume on signal', async () => {
    const orchWorkflowId = `test-orch-escalate-${MemFlow.guid()}`;

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
      expire: 120,
    });

    // Wait for the child workflow to escalate
    await sleepFor(8000);

    // Find the escalation — it should have routing fields
    const { escalations } = await escalationService.listEscalations({
      status: 'pending',
      type: 'reviewContent',
    });
    const esc = escalations.find(e =>
      e.description?.includes('confidence') && e.workflow_id,
    );
    expect(esc).toBeTruthy();
    expect(esc!.workflow_id).toBeTruthy();
    expect(esc!.task_queue).toBeTruthy();
    expect(esc!.workflow_type).toBe('reviewContent');

    // Verify task was created and is in needs_intervention
    const task = await taskService.getTaskByWorkflowId(esc!.workflow_id!);
    expect(task).toBeTruthy();
    expect(task!.status).toBe('needs_intervention');

    // Signal the CHILD workflow (not the orchestrator) using routing fields
    const childClient = new Client({
      connection: { class: Postgres, options: postgres_options },
    });
    const childHandle = await childClient.workflow.getHandle(
      esc!.task_queue!,
      esc!.workflow_type!,
      esc!.workflow_id!,
    );
    await childHandle.signal(`lt-resolve-${esc!.workflow_id!}`, {
      contentId: 'orch-esc-1',
      approved: true,
      humanNote: 'Reviewed via orchestrator path',
    });

    // Orchestrator should complete with the resolved data
    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);
    expect(result.data.humanNote).toBe('Reviewed via orchestrator path');

    // Verify the interceptor resolved the escalation record
    await sleepFor(500);
    const resolvedEsc = await escalationService.getEscalation(esc!.id);
    expect(resolvedEsc!.status).toBe('resolved');
    expect(resolvedEsc!.resolver_payload).toBeTruthy();
  }, 60_000);

  // ── executeLT: task record completed after escalation resolve ───────────────

  it('should complete the task record after escalation is resolved', async () => {
    const orchWorkflowId = `test-orch-complete-${MemFlow.guid()}`;

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
      expire: 120,
    });

    await sleepFor(8000);

    // Find and signal the escalation
    const { escalations } = await escalationService.listEscalations({
      status: 'pending',
      type: 'reviewContent',
    });
    const esc = escalations.find(e =>
      e.workflow_id && e.description?.includes('confidence'),
    );
    expect(esc).toBeTruthy();

    const childClient = new Client({
      connection: { class: Postgres, options: postgres_options },
    });
    const childHandle = await childClient.workflow.getHandle(
      esc!.task_queue!,
      esc!.workflow_type!,
      esc!.workflow_id!,
    );
    await childHandle.signal(`lt-resolve-${esc!.workflow_id!}`, {
      contentId: 'orch-complete-1',
      approved: true,
    });

    await handle.result();
    await sleepFor(500);

    // Verify the task is now completed (executeLT completes it)
    const task = await taskService.getTaskByWorkflowId(esc!.workflow_id!);
    expect(task).toBeTruthy();
    expect(task!.status).toBe('completed');
    expect(task!.data).toBeTruthy();
  }, 60_000);

  // ── Orchestrator pass-through: interceptor skips orchestrator workflows ─────

  it('should pass orchestrator workflows through without interception', async () => {
    // The orchestrator itself should not get a task record
    // (only the child workflow gets one via executeLT)
    const orchWorkflowId = `test-orch-passthrough-${MemFlow.guid()}`;

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
