import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation, waitForEscalationStatus, waitForTaskStatus } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import { createLTActivityInterceptor } from '../../interceptor/activity-interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as reviewContentWorkflow from '../../examples/workflows/review-content';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import type { LTReturn } from '../../types';

const { Connection, Client, Worker } = Durable;

const TASK_QUEUE = 'test-review';
const ACTIVITY_QUEUE = 'test-lt-interceptor';

describe('reviewContent workflow', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Seed config so the config-driven interceptor recognizes this workflow
    await configService.upsertWorkflowConfig({
      workflow_type: 'reviewContent',
      is_lt: true,
      is_container: false,
      invocable: false,
      task_queue: TASK_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: ['reviewer'],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    Durable.registerInterceptor(ltInterceptor);

    const ltActivityInterceptor = createLTActivityInterceptor();
    Durable.registerActivityInterceptor(ltActivityInterceptor);

    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: reviewContentWorkflow.reviewContent,
    });
    await worker.run();

    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Happy path: AI auto-approves ──────────────────────────────────────────

  it('should auto-approve high-confidence content', async () => {
    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'auto-1',
          content: 'This is perfectly fine content that should pass AI review without any issues whatsoever.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId: `test-approve-${Durable.guid()}`,
      expire: 60,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);
    expect(result.data.analysis.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.data.analysis.flags).toEqual([]);
    expect(result.milestones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ai_review', value: 'approved' }),
      ]),
    );
  }, 30_000);

  // ── Standalone: interceptor creates task automatically ────────────────────

  it('should create a task record in standalone mode (interceptor-managed)', async () => {
    const workflowId = `test-task-record-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'auto-2',
          content: 'Good content that auto-approves. Checking standalone mode.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);

    // The interceptor guarantees every LT workflow has a task record
    await sleepFor(500);
    const task = await taskService.getTaskByWorkflowId(workflowId);
    expect(task).toBeTruthy();
    expect(task!.status).toBe('completed');
    expect(task!.workflow_type).toBe('reviewContent');
    // Standalone: originId = own workflowId (this IS the root)
    expect(task!.origin_id).toBe(workflowId);
    // Standalone: no parent
    expect(task!.parent_id).toBeNull();
  }, 30_000);

  // ── Escalation: low confidence triggers HITL ──────────────────────────────

  it('should escalate low-confidence content and resolve via new workflow', async () => {
    const workflowId = `test-escalate-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: {
          contentId: 'esc-1',
          content: 'REVIEW_ME this content needs human review',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    // Poll until escalation appears
    const escalations = await waitForEscalation(workflowId, 15_000);
    expect(escalations.length).toBe(1);
    expect(escalations[0].status).toBe('pending');
    expect(escalations[0].role).toBe('reviewer');
    expect(escalations[0].description).toContain('confidence');

    // Resolve by starting a new workflow with resolver data
    const rerunId = await resolveEscalation(escalations[0].id, {
      contentId: 'esc-1',
      approved: true,
      humanNote: 'Reviewed and approved by human',
    });

    // Poll until escalation is resolved by the interceptor
    const resolvedEsc = await waitForEscalationStatus(escalations[0].id, 'resolved', 15_000);
    expect(resolvedEsc.resolved_at).toBeTruthy();
    expect(resolvedEsc.resolver_payload).toBeTruthy();
  }, 30_000);

  // ── Escalation: claim → resolve lifecycle ─────────────────────────────────

  it('should support the full claim → resolve escalation lifecycle', async () => {
    const workflowId = `test-claim-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: {
          contentId: 'esc-2',
          content: 'REVIEW_ME content for claim lifecycle test',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    // Poll until escalation appears
    const escalations = await waitForEscalation(workflowId, 15_000);
    const escalation = escalations[0];
    expect(escalation.status).toBe('pending');

    // Claim it — status stays 'pending' (claimed is implicit)
    const claimed = await escalationService.claimEscalation(
      escalation.id,
      'reviewer-42',
      30,
    );
    expect(claimed).toBeTruthy();
    expect(claimed!.escalation.status).toBe('pending');
    expect(claimed!.escalation.assigned_to).toBe('reviewer-42');
    expect(claimed!.escalation.claimed_at).toBeTruthy();
    expect(claimed!.isExtension).toBe(false);

    // Resolve by starting a new workflow
    await resolveEscalation(escalation.id, {
      contentId: 'esc-2',
      approved: false,
      reason: 'Content violates policy',
    });

    // Poll until resolved
    const resolvedEsc = await waitForEscalationStatus(escalation.id, 'resolved', 15_000);
    expect(resolvedEsc.resolved_at).toBeTruthy();
    expect(resolvedEsc.resolver_payload).toBeTruthy();
  }, 30_000);

  // ── Escalation: expired claim release ─────────────────────────────────────

  it('should release expired claims back to pending', async () => {
    const workflowId = `test-expire-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: {
          contentId: 'esc-3',
          content: 'REVIEW_ME content for expiry test',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    // Poll until escalation appears
    const escalations = await waitForEscalation(workflowId, 15_000);
    const escalation = escalations[0];

    // Claim with a 0-minute duration (expires immediately)
    const claimed = await escalationService.claimEscalation(escalation.id, 'reviewer-99', 0);
    expect(claimed).toBeTruthy();
    expect(claimed!.escalation.status).toBe('pending');

    // Wait a moment for the claim to expire
    await sleepFor(100);

    // Release expired claims (optional cleanup)
    const released = await escalationService.releaseExpiredClaims();
    expect(released).toBeGreaterThanOrEqual(1);

    // Verify assignment data was cleared
    const updated = await escalationService.getEscalation(escalation.id);
    expect(updated!.status).toBe('pending');
    expect(updated!.assigned_to).toBeNull();
  }, 30_000);

  // ── Error flag detection ──────────────────────────────────────────────────

  it('should escalate content with error flags', async () => {
    const workflowId = `test-error-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: {
          contentId: 'err-1',
          content: 'This content has an ERROR in it that should be flagged.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    // Poll until escalation appears
    const escalations = await waitForEscalation(workflowId, 15_000);
    expect(escalations.length).toBe(1);
    await resolveEscalation(escalations[0].id, {
      contentId: 'err-1',
      approved: true,
      note: 'Error was a false positive',
    });

    // Poll until resolved
    await waitForEscalationStatus(escalations[0].id, 'resolved', 15_000);
  }, 30_000);

  // ── Multiple workflows: isolation ─────────────────────────────────────────

  it('should handle multiple concurrent workflows independently', async () => {
    const ids = ['multi-1', 'multi-2', 'multi-3'];

    const handles = await Promise.all(
      ids.map(id =>
        client.workflow.start({
          args: [{
            data: { contentId: id, content: `Good content for ${id}` },
            metadata: {},
          }],
          taskQueue: TASK_QUEUE,
          workflowName: 'reviewContent',
          workflowId: `test-${id}-${Durable.guid()}`,
          expire: 60,
        }),
      ),
    );

    const results = await Promise.all(handles.map(h => h.result())) as LTReturn[];

    for (let i = 0; i < results.length; i++) {
      expect(results[i].type).toBe('return');
      expect(results[i].data.contentId).toBe(ids[i]);
      expect(results[i].data.approved).toBe(true);
    }
  }, 30_000);

  // ── Short content triggers too_short flag ─────────────────────────────────

  it('should escalate very short content', async () => {
    const workflowId = `test-short-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: {
          contentId: 'short-1',
          content: 'Hi',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    // Poll until escalation appears
    const escalations = await waitForEscalation(workflowId, 15_000);
    expect(escalations.length).toBe(1);
    await resolveEscalation(escalations[0].id, {
      contentId: 'short-1',
      approved: false,
      reason: 'Content too short to evaluate',
    });

    // Poll until resolved
    await waitForEscalationStatus(escalations[0].id, 'resolved', 15_000);
  }, 30_000);

  // ── Activity interceptor: clean analysis data in result ──────────────────

  it('should return clean analysis data with no wrapper artifacts', async () => {
    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'clean-1',
          content: 'Perfect content that passes review without any issues.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId: `test-clean-${Durable.guid()}`,
      expire: 60,
    });

    const result = await handle.result() as LTReturn;

    // The workflow returns clean ReviewAnalysis data
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);
    expect(result.data.analysis.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.data.analysis.flags).toEqual([]);
    expect(result.data.analysis.summary).toBeTruthy();
  }, 30_000);

  // ── INVARIANT: every escalation is tied to a task ─────────────────────────

  it('should always tie standalone escalations to a task record', async () => {
    const workflowId = `test-esc-task-inv-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: {
          contentId: 'inv-1',
          content: 'REVIEW_ME content for task-escalation invariant test',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 120,
    });

    // Poll until escalation appears
    const escalations = await waitForEscalation(workflowId, 15_000);
    expect(escalations.length).toBe(1);
    expect(escalations[0].task_id).toBeTruthy();

    // The task must exist and reflect the escalation state
    const task = await taskService.getTask(escalations[0].task_id!);
    expect(task).toBeTruthy();
    expect(task!.workflow_id).toBe(workflowId);
    expect(task!.status).toBe('needs_intervention');
    expect(task!.origin_id).toBe(workflowId);
    expect(task!.parent_id).toBeNull();

    // Clean up: resolve so the escalation doesn't pollute other tests
    await resolveEscalation(escalations[0].id, {
      contentId: 'inv-1',
      approved: true,
    });

    // Poll until task completes
    const completedTask = await waitForTaskStatus(escalations[0].task_id!, 'completed', 15_000);
    expect(completedTask.status).toBe('completed');
  }, 30_000);

  // ── Task lifecycle: standalone completion ──────────────────────────────────

  it('should complete the standalone task with result data and milestones', async () => {
    const workflowId = `test-standalone-complete-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'complete-1',
          content: 'Good content for standalone completion lifecycle test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');

    await sleepFor(500);

    const task = await taskService.getTaskByWorkflowId(workflowId);
    expect(task).toBeTruthy();
    expect(task!.status).toBe('completed');
    expect(task!.data).toBeTruthy();
    expect(task!.milestones.length).toBeGreaterThan(0);

    const data = JSON.parse(task!.data!);
    expect(data.approved).toBe(true);
  }, 30_000);
});
