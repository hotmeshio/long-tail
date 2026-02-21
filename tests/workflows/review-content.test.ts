import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { MemFlow } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as reviewContentWorkflow from '../../workflows/review-content';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import type { LTReturn } from '../../types';

const { Connection, Client, Worker } = MemFlow;

const TASK_QUEUE = 'test-review';
const ACTIVITY_QUEUE = 'test-lt-interceptor';

describe('reviewContent workflow', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
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
      task_queue: TASK_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: ['reviewer'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    await MemFlow.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    MemFlow.registerInterceptor(ltInterceptor);

    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: reviewContentWorkflow.reviewContent,
    });
    await worker.run();

    client = new Client({ connection });
  }, 60_000);

  afterAll(async () => {
    MemFlow.clearInterceptors();
    await sleepFor(1500);
    await MemFlow.shutdown();
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
      workflowId: `test-approve-${MemFlow.guid()}`,
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

  // ── Standalone: no task record without orchestrator ─────────────────────

  it('should not create a task record in standalone mode (no orchestrator)', async () => {
    const workflowId = `test-task-record-${MemFlow.guid()}`;

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

    // Standalone workflows don't create task records —
    // tasks are the orchestrator's responsibility
    const task = await taskService.getTaskByWorkflowId(workflowId);
    expect(task).toBeNull();
  }, 30_000);

  // ── Escalation: low confidence triggers HITL ──────────────────────────────

  it('should escalate low-confidence content and resolve via new workflow', async () => {
    const workflowId = `test-escalate-${MemFlow.guid()}`;

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

    // Wait for the workflow to complete (it ends on escalation now)
    await sleepFor(5000);

    // Verify escalation was created (found via workflow_id, not task)
    const escalations = await escalationService.getEscalationsByWorkflowId(workflowId);
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

    // Wait for the re-run workflow to complete
    await sleepFor(5000);

    // Verify the escalation was resolved by the interceptor
    const resolvedEsc = await escalationService.getEscalation(escalations[0].id);
    expect(resolvedEsc!.status).toBe('resolved');
    expect(resolvedEsc!.resolved_at).toBeTruthy();
    expect(resolvedEsc!.resolver_payload).toBeTruthy();
  }, 45_000);

  // ── Escalation: claim → resolve lifecycle ─────────────────────────────────

  it('should support the full claim → resolve escalation lifecycle', async () => {
    const workflowId = `test-claim-${MemFlow.guid()}`;

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

    await sleepFor(5000);

    // Find the pending escalation (via workflow_id)
    const escalations = await escalationService.getEscalationsByWorkflowId(workflowId);
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

    await sleepFor(5000);

    // Verify the interceptor resolved the escalation
    const resolvedEsc = await escalationService.getEscalation(escalation.id);
    expect(resolvedEsc!.status).toBe('resolved');
    expect(resolvedEsc!.resolved_at).toBeTruthy();
    expect(resolvedEsc!.resolver_payload).toBeTruthy();
  }, 45_000);

  // ── Escalation: expired claim release ─────────────────────────────────────

  it('should release expired claims back to pending', async () => {
    const workflowId = `test-expire-${MemFlow.guid()}`;

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

    await sleepFor(5000);

    const escalations = await escalationService.getEscalationsByWorkflowId(workflowId);
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
  }, 45_000);

  // ── Error flag detection ──────────────────────────────────────────────────

  it('should escalate content with error flags', async () => {
    const workflowId = `test-error-${MemFlow.guid()}`;

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

    await sleepFor(5000);

    // Find and resolve escalation (via workflow_id)
    const escalations = await escalationService.getEscalationsByWorkflowId(workflowId);
    expect(escalations.length).toBe(1);
    await resolveEscalation(escalations[0].id, {
      contentId: 'err-1',
      approved: true,
      note: 'Error was a false positive',
    });

    await sleepFor(5000);

    // Verify escalation was resolved
    const resolvedEsc = await escalationService.getEscalation(escalations[0].id);
    expect(resolvedEsc!.status).toBe('resolved');
  }, 45_000);

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
          workflowId: `test-${id}-${MemFlow.guid()}`,
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
    const workflowId = `test-short-${MemFlow.guid()}`;

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

    await sleepFor(5000);

    // Find and resolve escalation (via workflow_id)
    const escalations = await escalationService.getEscalationsByWorkflowId(workflowId);
    expect(escalations.length).toBe(1);
    await resolveEscalation(escalations[0].id, {
      contentId: 'short-1',
      approved: false,
      reason: 'Content too short to evaluate',
    });

    await sleepFor(5000);

    const resolvedEsc = await escalationService.getEscalation(escalations[0].id);
    expect(resolvedEsc!.status).toBe('resolved');
  }, 45_000);
});
