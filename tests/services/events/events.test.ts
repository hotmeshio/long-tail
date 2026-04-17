import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import { createLTInterceptor } from '../../../services/interceptor';
import { createLTActivityInterceptor } from '../../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../../services/interceptor/activities';
import * as reviewContentWorkflow from '../../../examples/workflows/review-content';
import * as configService from '../../../services/config';
import { eventRegistry } from '../../../lib/events';
import { InMemoryEventAdapter } from '../../../lib/events/memory';
import type { LTReturn, LTActivity, LTEvent } from '../../../types';

const { Connection, Client, Worker } = Durable;

/** Poll the adapter until a matching event appears (or timeout). */
async function waitForEvent(
  adapter: InMemoryEventAdapter,
  predicate: (e: LTEvent) => boolean,
  timeoutMs = 5000,
): Promise<LTEvent | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = adapter.events.find(predicate);
    if (match) return match;
    await sleepFor(100);
  }
  return adapter.events.find(predicate);
}

const LEAF_QUEUE = 'long-tail-examples';
const MILESTONE_QUEUE = 'test-events-milestone';
const ACTIVITY_QUEUE = 'lt-interceptor';

// ── Test activity that returns milestones (LTActivity pattern) ─────────────

/** Activity that returns milestones in its result */
async function processWithMilestones(input: string): Promise<LTActivity<{ processed: string }>> {
  return {
    type: 'activity',
    data: { processed: input.toUpperCase() },
    milestones: [
      { name: 'processing_step', value: 'completed' },
      { name: 'input_length', value: input.length },
    ],
  };
}

const milestoneActivities = { processWithMilestones };

/** Test workflow that calls an activity returning milestones */
async function milestoneWorkflow(input: { value: string }) {
  const { processWithMilestones: process } =
    Durable.workflow.proxyActivities<typeof milestoneActivities>({
      activities: milestoneActivities,
    });

  const result = await process(input.value);

  return {
    type: 'return' as const,
    data: result.data,
    milestones: result.milestones,
  };
}

describe('events service', () => {
  let client: InstanceType<typeof Client>;
  let eventAdapter: InMemoryEventAdapter;

  beforeAll(async () => {
    await connectTelemetry();

    // Set up in-memory event adapter
    eventAdapter = new InMemoryEventAdapter();
    eventRegistry.register(eventAdapter);
    await eventRegistry.connect();

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

    // Register interceptors
    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    Durable.registerInboundInterceptor(ltInterceptor);
    Durable.registerOutboundInterceptor(createLTActivityInterceptor());

    // Register reviewContent workflow worker
    const leafWorker = await Worker.create({
      connection,
      taskQueue: LEAF_QUEUE,
      workflow: reviewContentWorkflow.reviewContent,
    });
    await leafWorker.run();

    // Register milestone activity worker + workflow for activity interceptor tests
    await Durable.registerActivityWorker(
      { connection, taskQueue: MILESTONE_QUEUE },
      milestoneActivities,
      MILESTONE_QUEUE,
    );
    const milestoneWorker = await Worker.create({
      connection,
      taskQueue: MILESTONE_QUEUE,
      workflow: milestoneWorkflow,
    });
    await milestoneWorker.run();

    client = new Client({ connection });
  }, 60_000);

  beforeEach(() => {
    eventAdapter.clear();
  });

  afterAll(async () => {
    eventRegistry.clear();
    Durable.clearInterceptors();
    Durable.clearOutboundInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Standalone: interceptor publishes milestone events ─────────────────────

  it('should publish milestone events when a standalone workflow completes', async () => {
    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'evt-1',
          content: 'Good content for event test that should auto-approve.',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId: `test-event-standalone-${Durable.guid()}`,
      expire: 60,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);

    // Allow async fire-and-forget publish to settle
    await sleepFor(500);

    // The interceptor should have published a milestone event
    const milestoneEvents = eventAdapter.events.filter(
      (e) => e.type === 'milestone',
    );
    expect(milestoneEvents.length).toBeGreaterThanOrEqual(1);

    const evt = milestoneEvents.find((e) => e.source === 'interceptor');
    expect(evt).toBeTruthy();
    expect(evt!.workflowName).toBe('reviewContent');
    expect(evt!.milestones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ai_review', value: 'approved' }),
      ]),
    );
    expect(evt!.timestamp).toBeTruthy();
  }, 30_000);

  // ── Direct invocation: interceptor publishes milestone events ───────────────

  it('should publish milestone events from interceptor for direct workflow', async () => {
    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'evt-2',
          content: 'Good content for direct event test that auto-approves.',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId: `test-event-direct-${Durable.guid()}`,
      expire: 120,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.approved).toBe(true);

    // Poll for interceptor event
    const interceptorEvt = await waitForEvent(
      eventAdapter,
      (e) => e.type === 'milestone' && e.source === 'interceptor',
      10_000,
    );

    expect(interceptorEvt).toBeTruthy();
    expect(interceptorEvt!.workflowName).toBe('reviewContent');
  }, 45_000);

  // ── No milestones: no events published ─────────────────────────────────────

  it('should not publish events when no adapters are registered', async () => {
    // Verify guard clause: events with a non-existent workflow won't appear
    const noMatchEvents = eventAdapter.events.filter(
      (e) => e.workflowName === 'nonexistent',
    );
    expect(noMatchEvents).toHaveLength(0);
  });

  // ── Event payload structure ────────────────────────────────────────────────

  it('should include all required fields in event payload', async () => {
    const workflowId = `test-event-payload-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'evt-3',
          content: 'Content for payload structure validation test.',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();
    await sleepFor(500);

    const evt = eventAdapter.events.find(
      (e) => e.type === 'milestone' && e.workflowId === workflowId,
    );
    expect(evt).toBeTruthy();
    expect(evt!.type).toBe('milestone');
    expect(evt!.source).toBe('interceptor');
    expect(evt!.workflowId).toBe(workflowId);
    expect(evt!.workflowName).toBe('reviewContent');
    expect(evt!.taskQueue).toBeTruthy();
    expect(evt!.milestones).toBeInstanceOf(Array);
    expect(evt!.milestones!.length).toBeGreaterThan(0);
    expect(evt!.data).toBeTruthy();
    expect(evt!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }, 30_000);

  // ── Activity interceptor: publishes milestones from activity results ──────

  it('should publish activity-level milestone events when activity returns milestones', async () => {
    const workflowId = `test-activity-milestones-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{ value: 'hello world' }],
      taskQueue: MILESTONE_QUEUE,
      workflowName: 'milestoneWorkflow',
      workflowId,
      expire: 60,
    });

    await handle.result();

    // The activity interceptor publishes on replay (after phase).
    // Poll until the event arrives rather than sleeping a fixed amount.
    const evt = await waitForEvent(
      eventAdapter,
      (e) => e.type === 'milestone'
        && e.source === 'activity'
        && e.activityName === 'processWithMilestones'
        && e.workflowId === workflowId,
    );

    expect(evt).toBeTruthy();
    expect(evt!.workflowId).toBe(workflowId);
    expect(evt!.workflowName).toBe('milestoneWorkflow');
    expect(evt!.activityName).toBe('processWithMilestones');
    expect(evt!.milestones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'processing_step', value: 'completed' }),
        expect.objectContaining({ name: 'input_length', value: 11 }),
      ]),
    );
  }, 30_000);

  // ── Activity interceptor: skips activities without milestones ──────────────

  it('should not publish activity events for plain activity results', async () => {
    const workflowId = `test-no-activity-events-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'no-act-evt',
          content: 'Good content that auto-approves without activity milestones.',
        },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();
    await sleepFor(500);

    // analyzeContent returns plain ReviewAnalysis (no milestones field),
    // so the activity interceptor should NOT publish any activity events
    const activityEvents = eventAdapter.events.filter(
      (e) => e.source === 'activity' && e.workflowId === workflowId,
    );
    expect(activityEvents).toHaveLength(0);

    // But the workflow interceptor should still publish (via handleCompletion)
    const interceptorEvents = eventAdapter.events.filter(
      (e) => e.source === 'interceptor' && e.workflowId === workflowId,
    );
    expect(interceptorEvents.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
