import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable, DBA } from '@hotmeshio/hotmesh';
import type { WorkflowExecution } from '@hotmeshio/hotmesh/build/types/exporter';

import { postgres_options, sleepFor } from '../setup';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import { createLTActivityInterceptor } from '../../interceptor/activity-interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as reviewContentWorkflow from '../../workflows/review-content';
import * as exportService from '../../services/export';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';

const { Connection, Client, Worker } = Durable;

const TASK_QUEUE = 'test-export';
const ACTIVITY_QUEUE = 'test-export-interceptor';

const EXAMPLES = process.env.EXAMPLES === 'true';

describe('workflow state export', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();

    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

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

    // Deploy DBA prune function (adds pruned_at column if missing).
    // Must run after workers start because they create the 'durable' schema.
    await DBA.deploy(connection, 'durable');
  }, 60_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 15_000);

  // ── Raw export tests ────────────────────────────────────────────────────

  it('should export full state for a completed workflow', async () => {
    const workflowId = `test-export-full-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-1',
          content: 'Good content that auto-approves for export test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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

  it('should respect the allow filter', async () => {
    const workflowId = `test-export-allow-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-2',
          content: 'Good content for allow-filter test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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
    const workflowId = `test-export-block-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-3',
          content: 'Good content for block-filter test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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

  it('should include structured timeline entries with index and key', async () => {
    const workflowId = `test-export-timeline-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-4',
          content: 'Good content for timeline inspection.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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
    const workflowId = `test-export-transitions-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-5',
          content: 'Good content for transition inspection.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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

  it('should return status 0 for a completed workflow', async () => {
    const workflowId = `test-export-status-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-6',
          content: 'Content for status check.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

    const result = await exportService.getWorkflowStatus(
      workflowId,
      TASK_QUEUE,
      'reviewContent',
    );

    expect(result.workflow_id).toBe(workflowId);
    expect(result.status).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('should return job state for a completed workflow', async () => {
    const workflowId = `test-export-state-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-7',
          content: 'Content for state check.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

    const result = await exportService.getWorkflowState(
      workflowId,
      TASK_QUEUE,
      'reviewContent',
    );

    expect(result.workflow_id).toBe(workflowId);
    expect(result.state).toBeDefined();
    expect(typeof result.state).toBe('object');
  }, 30_000);

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

    // Wait for escalation to be created
    await sleepFor(5000);

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

    // Clean up: resolve the escalation
    const escalations = await escalationService.getEscalationsByWorkflowId(workflowId);
    expect(escalations.length).toBe(1);
    await resolveEscalation(escalations[0].id, {
      contentId: 'export-esc-1',
      approved: true,
    });
    await sleepFor(5000);
  }, 60_000);

  it('should return consistent exports for the same workflow', async () => {
    const workflowId = `test-export-consistent-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'export-8',
          content: 'Content for consistency check.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

    const first = await exportService.exportWorkflow(workflowId, TASK_QUEUE, 'reviewContent');
    const second = await exportService.exportWorkflow(workflowId, TASK_QUEUE, 'reviewContent');

    expect(first.workflow_id).toBe(second.workflow_id);
    expect(first.status).toBe(second.status);
    expect(first.timeline?.length).toBe(second.timeline?.length);
    expect(first.transitions?.length).toBe(second.transitions?.length);
  }, 30_000);

  // ── Temporal-like execution export (HotMesh native) ──────────────────

  it('should export a completed workflow as a Temporal-like execution', async () => {
    const workflowId = `test-exec-full-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'exec-1',
          content: 'Good content for execution export test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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
    // HotMesh uses the full topic 'taskQueue-workflowName' for both fields
    expect(execution.workflow_type).toContain('reviewContent');
    expect(execution.task_queue).toContain(TASK_QUEUE);
    expect(execution.status).toBe('completed');
    expect(execution.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(execution.close_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(execution.duration_ms).toBeGreaterThanOrEqual(0);
    expect(execution.result).toBeTruthy();

    // Events — HotMesh native format
    expect(execution.events.length).toBeGreaterThan(0);
    expect(execution.events[0].event_type).toBe('workflow_execution_started');
    expect(execution.events[execution.events.length - 1].event_type).toBe('workflow_execution_completed');

    // All events have required fields
    for (const event of execution.events) {
      expect(event.event_id).toBeGreaterThan(0);
      expect(event.event_type).toBeTruthy();
      expect(event.category).toBeTruthy();
      expect(event.event_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof event.is_system).toBe('boolean');
      expect(event.attributes).toBeDefined();
    }

    // Summary
    expect(execution.summary.total_events).toBe(execution.events.length);
    expect(execution.summary.activities.total).toBeGreaterThan(0);
    expect(execution.summary.activities.completed).toBeGreaterThan(0);
    expect(execution.summary.activities.failed).toBe(0);
  }, 30_000);

  it('should classify system vs user activities correctly', async () => {
    const workflowId = `test-exec-classify-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'exec-2',
          content: 'Content for system/user classification test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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
      const attrs = e.attributes as any;
      expect(attrs.activity_type).toMatch(/^lt/);
    }

    // User activities (analyzeContent) should have is_system=false
    const userEvents = activityEvents.filter(e => !e.is_system);
    expect(userEvents.length).toBeGreaterThan(0);
    for (const e of userEvents) {
      const attrs = e.attributes as any;
      expect(attrs.activity_type).not.toMatch(/^lt/);
    }

    // Summary should agree
    expect(execution.summary.activities.system).toBe(
      systemEvents.filter(e => e.event_type === 'activity_task_scheduled').length,
    );
    expect(execution.summary.activities.user).toBe(
      userEvents.filter(e => e.event_type === 'activity_task_scheduled').length,
    );
  }, 30_000);

  it('should filter out system activities with exclude_system option', async () => {
    const workflowId = `test-exec-nosys-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'exec-3',
          content: 'Content for exclude_system test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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

    // Filtered should have fewer events
    expect(filtered.events.length).toBeLessThan(full.events.length);

    // No system activities in filtered
    const systemInFiltered = filtered.events.filter(e => e.is_system);
    expect(systemInFiltered.length).toBe(0);

    // User activities should still be present
    const userInFiltered = filtered.events.filter(
      e => e.category === 'activity' && !e.is_system,
    );
    expect(userInFiltered.length).toBeGreaterThan(0);
  }, 30_000);

  it('should produce events in chronological order', async () => {
    const workflowId = `test-exec-order-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'exec-4',
          content: 'Content for chronological ordering test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

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

    // Event IDs should be sequential
    for (let i = 0; i < execution.events.length; i++) {
      expect(execution.events[i].event_id).toBe(i + 1);
    }
  }, 30_000);

  it('should compute duration_ms for activity events', async () => {
    const workflowId = `test-exec-dur-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'exec-5',
          content: 'Content for duration computation test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

    const execution = await exportService.exportWorkflowExecution(
      workflowId,
      TASK_QUEUE,
      'reviewContent',
    );

    // Completed activities should have a duration
    const completedActivities = execution.events.filter(
      e => e.event_type === 'activity_task_completed',
    );
    expect(completedActivities.length).toBeGreaterThan(0);
    for (const e of completedActivities) {
      expect(e.duration_ms).toBeGreaterThanOrEqual(0);
    }

    // Scheduled activities should have null duration
    const scheduledActivities = execution.events.filter(
      e => e.event_type === 'activity_task_scheduled',
    );
    for (const e of scheduledActivities) {
      expect(e.duration_ms).toBeNull();
    }
  }, 30_000);

  it('should include event cross-references (scheduled_event_id)', async () => {
    const workflowId = `test-exec-xref-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: {
          contentId: 'exec-6',
          content: 'Content for cross-reference test.',
        },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'reviewContent',
      workflowId,
      expire: 60,
    });

    await handle.result();

    const execution = await exportService.exportWorkflowExecution(
      workflowId,
      TASK_QUEUE,
      'reviewContent',
    );

    // Completed activity events should reference their scheduled event
    const completedActivities = execution.events.filter(
      e => e.event_type === 'activity_task_completed',
    );
    expect(completedActivities.length).toBeGreaterThan(0);

    for (const e of completedActivities) {
      const attrs = e.attributes as any;
      expect(attrs.scheduled_event_id).toBeDefined();
      expect(typeof attrs.scheduled_event_id).toBe('number');

      // The referenced scheduled event should exist
      const scheduled = execution.events.find(
        s => s.event_id === attrs.scheduled_event_id,
      );
      expect(scheduled).toBeDefined();
      expect(scheduled!.event_type).toBe('activity_task_scheduled');
    }
  }, 30_000);

  // ── DBA prune tests (entity-scoped) ─────────────────────────────────
  //
  // HotMesh's DBA.prune supports entity-scoped pruning via the `entities`
  // allowlist.  When provided, only jobs whose `entity` column matches are
  // eligible — everything else is implicitly blacklisted.  NULL-entity
  // (transient) jobs are always excluded from a whitelist prune because
  // SQL IN never matches NULL.
  //
  // The `entity` field is set at workflow-start time alongside the normal
  // taskQueue + workflowName routing.

  describe('DBA prune (entity-scoped)', () => {
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
      // Tag one job 'reviewContent', another 'auditLog'
      const whiteId = await startCompleted('white', 'reviewContent');
      const blackId = await startCompleted('black', 'auditLog');

      // Whitelist prune: only 'reviewContent' entity
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

      // Whitelisted job: export still works (jmark preserved)
      const whiteExport = await exportService.exportWorkflowExecution(
        whiteId, TASK_QUEUE, 'reviewContent',
      );
      expect(whiteExport.status).toBe('completed');
      expect(whiteExport.events.length).toBeGreaterThan(0);

      // Non-whitelisted job: also exports — it was never touched
      const blackExport = await exportService.exportWorkflowExecution(
        blackId, TASK_QUEUE, 'reviewContent',
      );
      expect(blackExport.status).toBe('completed');
      expect(blackExport.events.length).toBeGreaterThan(0);
    }, 30_000);

    it('should leave non-whitelisted entities unpruned (implicit blacklist)', async () => {
      // Create a job tagged 'auditLog'
      const auditId = await startCompleted('blacklist', 'auditLog');

      // Prune targeting 'auditLog' — proves it was unpruned until now
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

      // Export still works after pruning the auditLog entity
      const auditExport = await exportService.exportWorkflowExecution(
        auditId, TASK_QUEUE, 'reviewContent',
      );
      expect(auditExport.status).toBe('completed');
      expect(auditExport.events.length).toBeGreaterThan(0);
    }, 30_000);

    it('should skip NULL-entity (transient) jobs when entity filter is set', async () => {
      // Start a workflow with no entity — transient
      const transientId = await startCompleted('transient');

      // Entity-scoped prune: NULL never matches SQL IN(...)
      const result = await DBA.prune({
        appId: 'durable',
        connection: { class: Postgres, options: postgres_options },
        expire: '0 seconds',
        jobs: false,
        streams: false,
        attributes: true,
        entities: ['reviewContent'],
      });

      // All 'reviewContent'-entity jobs were already pruned → marked=0
      expect(result.marked).toBe(0);

      // Transient job still has full artifacts (untouched by whitelist prune)
      const transientExport = await exportService.exportWorkflowExecution(
        transientId, TASK_QUEUE, 'reviewContent',
      );
      expect(transientExport.status).toBe('completed');
      expect(transientExport.events.length).toBeGreaterThan(0);
    }, 30_000);

    it('should be idempotent (re-prune yields marked=0)', async () => {
      // Broad prune (no entity filter) catches everything remaining
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

      // Second pass: everything already marked → idempotent
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
