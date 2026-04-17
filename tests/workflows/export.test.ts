import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable, DBA } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation, waitForEscalationStatus } from '../setup';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../lib/db/migrate';
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';
import * as reviewContentWorkflow from '../../examples/workflows/review-content';
import * as exportService from '../../services/export';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';

const { Connection, Client, Worker } = Durable;

const TASK_QUEUE = 'test-export';
const ACTIVITY_QUEUE = 'test-export-interceptor';

const EXAMPLES = process.env.EXAMPLES === 'true';

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Export
//
// This suite tells the story of how workflow state becomes observable data.
// A workflow runs, completes, and we export its internal state in two formats:
//
//   1. Raw HotMesh export — the low-level state, timeline, and transitions
//   2. Execution event history — a structured event stream with
//      typed events, durations, cross-references, and system/user classification
//
// The tests progress from simple exports through filtering, escalation,
// consistency, and finally data lifecycle (prune + re-export).
// ─────────────────────────────────────────────────────────────────────────────

describe('workflow export', () => {
  let client: InstanceType<typeof Client>;

  /** Start a workflow that auto-completes and return its ID. */
  async function startAndComplete(suffix: string, contentId?: string) {
    const workflowId = `test-export-${suffix}-${Durable.guid()}`;
    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: contentId || suffix,
          content: `Good content for ${suffix} test.`,
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });
    await handle.result();
    return workflowId;
  }

  beforeAll(async () => {
    await connectTelemetry();

    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    await configService.upsertWorkflowConfig({
      workflow_type: 'reviewContent',
      invocable: false,
      task_queue: TASK_QUEUE,
      default_role: 'reviewer',
      description: null,
      roles: ['reviewer'],
      invocation_roles: [],
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
    Durable.registerInboundInterceptor(ltInterceptor);

    const ltActivityInterceptor = createLTActivityInterceptor();
    Durable.registerOutboundInterceptor(ltActivityInterceptor);

    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: reviewContentWorkflow.reviewContent,
    });
    await worker.run();

    client = new Client({ connection });

    // Deploy DBA prune function (adds pruned_at column if missing).
    // Must run after workers start because they create the 'durable' schema.
    await DBA.deploy(connection, 'durable');
  }, 60_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearOutboundInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 15_000);

  // ── 1. Raw HotMesh export ──────────────────────────────────────────────
  //
  // The simplest export: run a workflow, then retrieve its full internal
  // state including data, status, timeline, and transition history.

  describe('raw HotMesh export', () => {
    it('should export full state for a completed workflow', async () => {
      const workflowId = await startAndComplete('full', 'export-1');

      const exported = await exportService.exportWorkflow(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      expect(exported.workflow_id).toBe(workflowId);
      expect(exported.status).toBeGreaterThanOrEqual(0);
      expect(exported.data).toBeDefined();
      expect(exported.state).toBeDefined();
      expect(exported.timeline).toBeDefined();
      expect(Array.isArray(exported.timeline)).toBe(true);
      expect(exported.transitions).toBeDefined();
      expect(Array.isArray(exported.transitions)).toBe(true);
    }, 30_000);

    it('should include structured timeline entries with index and key', async () => {
      const workflowId = await startAndComplete('timeline', 'export-4');

      const exported = await exportService.exportWorkflow(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
        { allow: ['timeline'] },
      );

      expect(exported.timeline).toBeDefined();
      expect(exported.timeline!.length).toBeGreaterThan(0);

      for (const entry of exported.timeline!) {
        expect(entry).toHaveProperty('key');
        expect(entry).toHaveProperty('index');
        expect(typeof entry.key).toBe('string');
        expect(typeof entry.index).toBe('number');
      }
    }, 30_000);

    it('should include structured transition entries', async () => {
      const workflowId = await startAndComplete('transitions', 'export-5');

      const exported = await exportService.exportWorkflow(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
        { allow: ['transitions'] },
      );

      expect(exported.transitions).toBeDefined();
      expect(exported.transitions!.length).toBeGreaterThan(0);

      for (const transition of exported.transitions!) {
        expect(transition).toHaveProperty('activity');
        expect(transition).toHaveProperty('dimensions');
        expect(transition).toHaveProperty('created');
        expect(transition).toHaveProperty('updated');
      }
    }, 30_000);

    it('should return consistent exports for the same workflow', async () => {
      const workflowId = await startAndComplete('consistent', 'export-8');

      const first = await exportService.exportWorkflow(workflowId, TASK_QUEUE, 'reviewContent');
      const second = await exportService.exportWorkflow(workflowId, TASK_QUEUE, 'reviewContent');

      expect(first.workflow_id).toBe(second.workflow_id);
      expect(first.status).toBeGreaterThanOrEqual(0);
      expect(second.status).toBeGreaterThanOrEqual(0);
      expect(first.timeline?.length).toBe(second.timeline?.length);
      expect(first.transitions?.length).toBe(second.transitions?.length);
    }, 30_000);
  });

  // ── 2. Export filtering ────────────────────────────────────────────────
  //
  // Exports support allow/block filters to control which facets are
  // returned. This keeps payloads lean when callers only need a subset.

  describe('export filtering', () => {
    it('should respect the allow filter', async () => {
      const workflowId = await startAndComplete('allow', 'export-2');

      const exported = await exportService.exportWorkflow(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
        { allow: ['status', 'data', 'timeline', 'transitions', 'state'] },
      );

      expect(exported.workflow_id).toBe(workflowId);
      expect(exported.status).toBeDefined();
      expect(exported.data).toBeDefined();
    }, 30_000);

    it('should respect the block filter', async () => {
      const workflowId = await startAndComplete('block', 'export-3');

      const exported = await exportService.exportWorkflow(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
        { block: ['timeline', 'transitions'] },
      );

      expect(exported.workflow_id).toBe(workflowId);
      expect(exported.status).toBeDefined();
      expect(exported.data).toBeDefined();
      expect(exported.state).toBeDefined();
      expect(exported.timeline).toBeUndefined();
      expect(exported.transitions).toBeUndefined();
    }, 30_000);
  });

  // ── 3. Workflow observation ────────────────────────────────────────────
  //
  // Status and state queries provide lightweight observation without
  // the overhead of a full export.

  describe('workflow observation', () => {
    it('should return status 0 for a completed workflow', async () => {
      const workflowId = await startAndComplete('status', 'export-6');

      const result = await exportService.getWorkflowStatus(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      expect(result.workflow_id).toBe(workflowId);
      expect(result.status).toBeGreaterThanOrEqual(0);
    }, 30_000);

    it('should return job state for a completed workflow', async () => {
      const workflowId = await startAndComplete('state', 'export-7');

      const result = await exportService.getWorkflowState(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      expect(result.workflow_id).toBe(workflowId);
      expect(result.state).toBeDefined();
      expect(typeof result.state).toBe('object');
    }, 30_000);
  });

  // ── 4. Escalated workflows ─────────────────────────────────────────────
  //
  // When a workflow escalates (pauses for human review), its state is
  // still fully exportable. This proves export works mid-flight.

  describe('escalated workflows', () => {
    it('should export state for an escalated workflow', async () => {
      const workflowId = `test-export-esc-${Durable.guid()}`;

      await client.workflow.start({
        args: [{
          data: {
            contentId: 'export-esc-1',
            content: 'REVIEW_ME content that triggers escalation for export test',
          },
          metadata: {},
        }],
        taskQueue: TASK_QUEUE,
        workflowName: 'reviewContent',
        workflowId,
        expire: 120,
      });

      // Poll until the escalation record is created (replaces fragile sleepFor)
      const escalations = await waitForEscalation(workflowId, 30_000, 1_000);
      expect(escalations.length).toBe(1);

      const exported = await exportService.exportWorkflow(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      expect(exported.workflow_id).toBe(workflowId);
      expect(exported.status).toBe(0);
      expect(exported.data).toBeDefined();
      expect(exported.timeline).toBeDefined();
      expect(exported.transitions).toBeDefined();

      // Clean up: resolve the escalation and wait for completion
      await resolveEscalation(escalations[0].id, {
        contentId: 'export-esc-1',
        approved: true,
      });
      await waitForEscalationStatus(escalations[0].id, 'resolved', 30_000);
    }, 60_000);
  });

  // ── 5. Execution event history ─────────────────────────────────────────
  //
  // The structured execution export translates HotMesh's internal
  // state into a typed event stream. Each event has an ISO timestamp,
  // duration, category, and system/user classification.

  describe('execution event history', () => {
    it('should export a completed workflow as a typed event stream', async () => {
      const workflowId = await startAndComplete('exec-full', 'exec-1');

      const execution = await exportService.exportWorkflowExecution(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      if (EXAMPLES) {
        console.log('\n── Execution Export (full) ──');
        console.log(JSON.stringify(execution, null, 2));
      }

      // Top-level metadata
      expect(execution.workflow_id).toBe(workflowId);
      expect(execution.workflow_type).toContain('reviewContent');
      expect(execution.task_queue).toContain(TASK_QUEUE);
      expect(execution.status).toBe('completed');
      expect(execution.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(execution.close_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(execution.duration_ms).toBeGreaterThanOrEqual(0);
      expect(execution.result).toBeTruthy();

      // Events bookend the lifecycle
      expect(execution.events.length).toBeGreaterThan(0);
      expect(execution.events[0].event_type).toBe('workflow_execution_started');
      expect(execution.events[execution.events.length - 1].event_type).toBe('workflow_execution_completed');

      // All events have the required shape
      for (const event of execution.events) {
        expect(event.event_id).toBeGreaterThan(0);
        expect(event.event_type).toBeTruthy();
        expect(event.category).toBeTruthy();
        expect(event.event_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(typeof event.is_system).toBe('boolean');
        expect(event.attributes).toBeDefined();
      }

      // Summary tallies match events
      expect(execution.summary.total_events).toBe(execution.events.length);
      expect(execution.summary.activities.total).toBeGreaterThan(0);
      expect(execution.summary.activities.completed).toBeGreaterThan(0);
      expect(execution.summary.activities.failed).toBe(0);
    }, 30_000);

    it('should produce events in chronological order with sequential IDs', async () => {
      const workflowId = await startAndComplete('exec-order', 'exec-4');

      const execution = await exportService.exportWorkflowExecution(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      for (let i = 1; i < execution.events.length; i++) {
        const prev = execution.events[i - 1].event_time;
        const curr = execution.events[i].event_time;
        expect(curr >= prev).toBe(true);
      }

      for (let i = 0; i < execution.events.length; i++) {
        expect(execution.events[i].event_id).toBe(i + 1);
      }
    }, 30_000);
  });

  // ── 6. Event classification and filtering ──────────────────────────────
  //
  // Activities are classified as system (lt*) or user. The exclude_system
  // option strips system activities from the export for cleaner output.

  describe('event classification and filtering', () => {
    it('should classify system vs user activities correctly', async () => {
      const workflowId = await startAndComplete('exec-classify', 'exec-2');

      const execution = await exportService.exportWorkflowExecution(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      const activityEvents = execution.events.filter(
        e => e.category === 'activity',
      );

      // System activities (lt*) should have is_system=true
      const systemEvents = activityEvents.filter(e => e.is_system);
      expect(systemEvents.length).toBeGreaterThan(0);
      for (const e of systemEvents) {
        expect((e.attributes as any).activity_type).toMatch(/^lt/);
      }

      // User activities should have is_system=false
      const userEvents = activityEvents.filter(e => !e.is_system);
      expect(userEvents.length).toBeGreaterThan(0);
      for (const e of userEvents) {
        expect((e.attributes as any).activity_type).not.toMatch(/^lt/);
      }

      // Summary should agree with events
      expect(execution.summary.activities.system).toBe(
        systemEvents.filter(e => e.event_type === 'activity_task_scheduled').length,
      );
      expect(execution.summary.activities.user).toBe(
        userEvents.filter(e => e.event_type === 'activity_task_scheduled').length,
      );
    }, 30_000);

    it('should filter out system activities with exclude_system option', async () => {
      const workflowId = await startAndComplete('exec-nosys', 'exec-3');

      const [full, filtered] = await Promise.all([
        exportService.exportWorkflowExecution(workflowId, TASK_QUEUE, 'reviewContent'),
        exportService.exportWorkflowExecution(workflowId, TASK_QUEUE, 'reviewContent', {
          exclude_system: true,
        }),
      ]);

      if (EXAMPLES) {
        console.log('\n── Execution Export (exclude_system) ──');
        console.log(JSON.stringify(filtered, null, 2));
      }

      expect(filtered.events.length).toBeLessThan(full.events.length);

      const systemInFiltered = filtered.events.filter(e => e.is_system);
      expect(systemInFiltered.length).toBe(0);

      const userInFiltered = filtered.events.filter(
        e => e.category === 'activity' && !e.is_system,
      );
      expect(userInFiltered.length).toBeGreaterThan(0);
    }, 30_000);
  });

  // ── 7. Event durations and cross-references ────────────────────────────
  //
  // Completed activities carry duration_ms and back-reference their
  // scheduled event. This enables timeline visualization and latency
  // analysis in the dashboard.

  describe('event durations and cross-references', () => {
    it('should compute duration_ms for activity events', async () => {
      const workflowId = await startAndComplete('exec-dur', 'exec-5');

      const execution = await exportService.exportWorkflowExecution(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      const completedActivities = execution.events.filter(
        e => e.event_type === 'activity_task_completed',
      );
      expect(completedActivities.length).toBeGreaterThan(0);
      for (const e of completedActivities) {
        expect(e.duration_ms).toBeGreaterThanOrEqual(0);
      }

      const scheduledActivities = execution.events.filter(
        e => e.event_type === 'activity_task_scheduled',
      );
      for (const e of scheduledActivities) {
        expect(e.duration_ms).toBeNull();
      }
    }, 30_000);

    it('should include event cross-references (scheduled_event_id)', async () => {
      const workflowId = await startAndComplete('exec-xref', 'exec-6');

      const execution = await exportService.exportWorkflowExecution(
        workflowId,
        TASK_QUEUE,
        'reviewContent',
      );

      const completedActivities = execution.events.filter(
        e => e.event_type === 'activity_task_completed',
      );
      expect(completedActivities.length).toBeGreaterThan(0);

      for (const e of completedActivities) {
        const attrs = e.attributes as any;
        expect(attrs.scheduled_event_id).toBeDefined();
        expect(typeof attrs.scheduled_event_id).toBe('number');

        const scheduled = execution.events.find(
          s => s.event_id === attrs.scheduled_event_id,
        );
        expect(scheduled).toBeDefined();
        expect(scheduled!.event_type).toBe('activity_task_scheduled');
      }
    }, 30_000);
  });

  // ── 8. Data lifecycle: prune and re-export ─────────────────────────────
  //
  // HotMesh's DBA.prune marks completed job attributes for cleanup.
  // Entity-scoped pruning uses an allowlist so only matching jobs are
  // affected. After pruning, HotMesh's native exportExecution still
  // produces a complete event history.

  describe('data lifecycle (DBA prune)', () => {
    /** Start a workflow that auto-completes, optionally tagged with an entity. */
    async function startCompleted(suffix: string, entity?: string) {
      const workflowId = `test-prune-${suffix}-${Durable.guid()}`;
      const opts: Record<string, unknown> = {
        args: [{
          data: { contentId: suffix, content: 'Good content for prune test.' },
          metadata: {},
        }],
        taskQueue: TASK_QUEUE,
        workflowName: 'reviewContent',
        workflowId,
        expire: 60,
      };
      if (entity) opts.entity = entity;
      const handle = await client.workflow.start(opts as any);
      await handle.result();
      return workflowId;
    }

    it('should prune only whitelisted entities', async () => {
      const whiteId = await startCompleted('white', 'reviewContent');
      const blackId = await startCompleted('black', 'auditLog');

      const result = await DBA.prune({
        appId: 'durable',
        connection: { class: Postgres, options: postgres_options },
        expire: '0 seconds',
        jobs: false,
        streams: false,
        attributes: true,
        entities: ['reviewContent'],
      });

      if (EXAMPLES) {
        console.log('\n── DBA Prune (whitelist: reviewContent) ──');
        console.log(JSON.stringify(result, null, 2));
      }

      expect(result.marked).toBeGreaterThan(0);
      expect(result.attributes).toBeGreaterThan(0);

      // Both jobs still export — whitelisted pruned but still exportable, non-whitelisted untouched
      const whiteExport = await exportService.exportWorkflowExecution(
        whiteId, TASK_QUEUE, 'reviewContent',
      );
      expect(whiteExport.status).toBe('completed');
      expect(whiteExport.events.length).toBeGreaterThan(0);

      const blackExport = await exportService.exportWorkflowExecution(
        blackId, TASK_QUEUE, 'reviewContent',
      );
      expect(blackExport.status).toBe('completed');
      expect(blackExport.events.length).toBeGreaterThan(0);
    }, 30_000);

    it('should leave non-whitelisted entities unpruned (implicit blacklist)', async () => {
      const auditId = await startCompleted('blacklist', 'auditLog');

      const result = await DBA.prune({
        appId: 'durable',
        connection: { class: Postgres, options: postgres_options },
        expire: '0 seconds',
        jobs: false,
        streams: false,
        attributes: true,
        entities: ['auditLog'],
      });

      if (EXAMPLES) {
        console.log('\n── DBA Prune (whitelist: auditLog) ──');
        console.log(JSON.stringify(result, null, 2));
      }

      expect(result.marked).toBeGreaterThan(0);

      const auditExport = await exportService.exportWorkflowExecution(
        auditId, TASK_QUEUE, 'reviewContent',
      );
      expect(auditExport.status).toBe('completed');
      expect(auditExport.events.length).toBeGreaterThan(0);
    }, 30_000);

    it('should skip NULL-entity (transient) jobs when entity filter is set', async () => {
      const transientId = await startCompleted('transient');

      const result = await DBA.prune({
        appId: 'durable',
        connection: { class: Postgres, options: postgres_options },
        expire: '0 seconds',
        jobs: false,
        streams: false,
        attributes: true,
        entities: ['reviewContent'],
      });

      // All 'reviewContent'-entity jobs were already pruned
      expect(result.marked).toBe(0);

      // Transient job still has full artifacts (untouched by whitelist prune)
      const transientExport = await exportService.exportWorkflowExecution(
        transientId, TASK_QUEUE, 'reviewContent',
      );
      expect(transientExport.status).toBe('completed');
      expect(transientExport.events.length).toBeGreaterThan(0);
    }, 30_000);

    it('should be idempotent (re-prune yields marked=0)', async () => {
      const firstPass = await DBA.prune({
        appId: 'durable',
        connection: { class: Postgres, options: postgres_options },
        expire: '0 seconds',
        jobs: false,
        streams: false,
        attributes: true,
      });

      if (EXAMPLES) {
        console.log('\n── DBA Prune (broad — all entities) ──');
        console.log(JSON.stringify(firstPass, null, 2));
      }

      const secondPass = await DBA.prune({
        appId: 'durable',
        connection: { class: Postgres, options: postgres_options },
        expire: '0 seconds',
        jobs: false,
        streams: false,
        attributes: true,
      });
      expect(secondPass.marked).toBe(0);
    }, 30_000);
  });
});
