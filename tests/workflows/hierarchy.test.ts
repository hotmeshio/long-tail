import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalationByOriginId } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';
import * as configService from '../../services/config';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import { ltConfig } from '../../modules/ltconfig';
import { executeLT } from '../../services/orchestrator';
import { getPool } from '../../services/db';
import type { LTEnvelope, LTReturn, LTEscalation, LTTaskRecord } from '../../types';

const { Connection, Client, Worker } = Durable;

// ── Queues ───────────────────────────────────────────────────────────────────

const LEAF_QUEUE = 'test-hier-leaf';
const SUB_ORCH_QUEUE = 'test-hier-sub';
const TOP_ORCH_QUEUE = 'test-hier-top';
const ACTIVITY_QUEUE = 'lt-interceptor';

// ── Leaf workflows ───────────────────────────────────────────────────────────

async function leafA1(envelope: LTEnvelope): Promise<LTReturn> {
  return { type: 'return', data: { step: 'leafA1', input: envelope.data } };
}

async function leafA2(envelope: LTEnvelope): Promise<LTReturn> {
  return { type: 'return', data: { step: 'leafA2', input: envelope.data } };
}

async function leafB1(envelope: LTEnvelope): Promise<LTReturn> {
  return { type: 'return', data: { step: 'leafB1', input: envelope.data } };
}

async function leafB2(envelope: LTEnvelope): Promise<LTReturn> {
  return { type: 'return', data: { step: 'leafB2', input: envelope.data } };
}

/**
 * leafB3 conditionally escalates when envelope.data.escalateB3 is set.
 * On re-entry after resolution, returns the resolver's decision.
 */
async function leafB3(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  if (envelope.resolver) {
    return {
      type: 'return',
      data: { step: 'leafB3', resolved: true, resolution: envelope.resolver },
    };
  }
  if (envelope.data.escalateB3) {
    return {
      type: 'escalation',
      data: { step: 'leafB3', reason: 'test escalation' },
      message: 'Hierarchy test escalation from leafB3',
      role: 'reviewer',
    };
  }
  return { type: 'return', data: { step: 'leafB3', input: envelope.data } };
}

// ── Sub-orchestrators (containers) ───────────────────────────────────────────

async function subOrchA(envelope: LTEnvelope) {
  const r1 = await executeLT({
    workflowName: 'leafA1',
    args: [{ ...envelope, lt: { ...envelope.lt } }],
    taskQueue: LEAF_QUEUE,
  });
  const r2 = await executeLT({
    workflowName: 'leafA2',
    args: [{ ...envelope, lt: { ...envelope.lt } }],
    taskQueue: LEAF_QUEUE,
  });
  return { type: 'return', data: { branch: 'A', results: [r1, r2] } };
}

async function subOrchB(envelope: LTEnvelope) {
  const r1 = await executeLT({
    workflowName: 'leafB1',
    args: [{ ...envelope, lt: { ...envelope.lt } }],
    taskQueue: LEAF_QUEUE,
  });
  const r2 = await executeLT({
    workflowName: 'leafB2',
    args: [{ ...envelope, lt: { ...envelope.lt } }],
    taskQueue: LEAF_QUEUE,
  });
  const r3 = await executeLT({
    workflowName: 'leafB3',
    args: [{ ...envelope, lt: { ...envelope.lt } }],
    taskQueue: LEAF_QUEUE,
  });
  return { type: 'return', data: { branch: 'B', results: [r1, r2, r3] } };
}

// ── Top-level orchestrator (container) ───────────────────────────────────────

async function topLevelOrch(envelope: LTEnvelope) {
  const resultA = await executeLT({
    workflowName: 'subOrchA',
    args: [envelope],
    taskQueue: SUB_ORCH_QUEUE,
  });
  const resultB = await executeLT({
    workflowName: 'subOrchB',
    args: [envelope],
    taskQueue: SUB_ORCH_QUEUE,
  });
  return { branchA: resultA, branchB: resultB };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch all tasks sharing a given origin_id directly from Postgres. */
async function getTasksByOriginId(originId: string): Promise<LTTaskRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_tasks WHERE origin_id = $1 ORDER BY created_at',
    [originId],
  );
  return rows;
}

// ── Config constants ─────────────────────────────────────────────────────────

const LEAF_TYPES = ['leafA1', 'leafA2', 'leafB1', 'leafB2', 'leafB3'];
const SUB_ORCH_TYPES = ['subOrchA', 'subOrchB'];
const ALL_TYPES = [...SUB_ORCH_TYPES, ...LEAF_TYPES];

const defaultConfig = {
  invocable: false as const,
  default_role: 'reviewer',
  default_modality: 'default',
  description: null,
  roles: ['reviewer'],
  invocation_roles: [] as string[],
  consumes: [] as string[],
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('workflow hierarchy (nested containers + lineage)', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // ── Seed configs ──────────────────────────────────────────────────

    // Leaf workflows (isLT: true, isContainer: false)
    for (const wfType of LEAF_TYPES) {
      await configService.upsertWorkflowConfig({
        workflow_type: wfType,
        is_lt: true,
        is_container: false,
        task_queue: LEAF_QUEUE,
        ...defaultConfig,
      });
    }

    // Sub-orchestrators (isLT: false, isContainer: true)
    for (const wfType of SUB_ORCH_TYPES) {
      await configService.upsertWorkflowConfig({
        workflow_type: wfType,
        is_lt: false,
        is_container: true,
        task_queue: SUB_ORCH_QUEUE,
        ...defaultConfig,
        roles: [],
      });
    }

    // Top-level orchestrator (isLT: false, isContainer: true)
    await configService.upsertWorkflowConfig({
      workflow_type: 'topLevelOrch',
      is_lt: false,
      is_container: true,
      task_queue: TOP_ORCH_QUEUE,
      ...defaultConfig,
      roles: [],
    });

    ltConfig.invalidate();

    const connection = { class: Postgres, options: postgres_options };

    // ── Register workers ─────────────────────────────────────────────

    // Shared interceptor activity worker
    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    // Interceptors
    Durable.registerInterceptor(
      createLTInterceptor({ activityTaskQueue: ACTIVITY_QUEUE }),
    );
    Durable.registerActivityInterceptor(createLTActivityInterceptor());

    // Leaf workers (all on the same queue, different workflow functions)
    for (const wf of [leafA1, leafA2, leafB1, leafB2, leafB3]) {
      const w = await Worker.create({
        connection,
        taskQueue: LEAF_QUEUE,
        workflow: wf,
      });
      await w.run();
    }

    // Sub-orchestrator workers
    for (const wf of [subOrchA, subOrchB]) {
      const w = await Worker.create({
        connection,
        taskQueue: SUB_ORCH_QUEUE,
        workflow: wf,
      });
      await w.run();
    }

    // Top-level orchestrator worker
    const topWorker = await Worker.create({
      connection,
      taskQueue: TOP_ORCH_QUEUE,
      workflow: topLevelOrch,
    });
    await topWorker.run();

    client = new Client({ connection });
  }, 30_000);

  afterAll(async () => {
    // Clean up configs
    for (const wfType of [...ALL_TYPES, 'topLevelOrch']) {
      await configService.deleteWorkflowConfig(wfType);
    }
    ltConfig.invalidate();
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Happy path: all workflows complete ─────────────────────────────────────

  describe('happy path (all workflows complete)', () => {
    let topOrchWorkflowId: string;
    let allTasks: LTTaskRecord[];

    beforeAll(async () => {
      topOrchWorkflowId = `test-hier-happy-${Durable.guid()}`;

      const handle = await client.workflow.start({
        args: [{ data: { testId: 'hierarchy-happy' }, metadata: {} }],
        taskQueue: TOP_ORCH_QUEUE,
        workflowName: 'topLevelOrch',
        workflowId: topOrchWorkflowId,
        expire: 180,
      });

      const result = await handle.result();
      expect(result).toBeTruthy();

      // Allow final DB writes to settle
      await sleepFor(1000);

      // Fetch all tasks belonging to this hierarchy
      allTasks = await getTasksByOriginId(topOrchWorkflowId);
    }, 30_000);

    it('should create exactly 7 task records (2 sub-orchestrators + 5 leaves)', () => {
      expect(allTasks).toHaveLength(7);

      const types = allTasks.map((t) => t.workflow_type).sort();
      expect(types).toEqual(ALL_TYPES.sort());
    });

    it('should NOT create a task record for the top-level container', async () => {
      const topTask = await taskService.getTaskByWorkflowId(topOrchWorkflowId);
      expect(topTask).toBeNull();
    });

    it('should set originId to the top-level orchestrator workflow ID for ALL tasks', () => {
      for (const task of allTasks) {
        expect(task.origin_id).toBe(topOrchWorkflowId);
      }
    });

    it('should complete all 7 tasks', () => {
      for (const task of allTasks) {
        expect(task.status).toBe('completed');
      }
    });

    it('should set parentId to the top-level orchestrator for sub-orchestrator tasks', () => {
      const subOrchTasks = allTasks.filter((t) =>
        SUB_ORCH_TYPES.includes(t.workflow_type),
      );
      expect(subOrchTasks).toHaveLength(2);

      for (const task of subOrchTasks) {
        expect(task.parent_id).toBe(topOrchWorkflowId);
      }
    });

    it('should set parentId to subOrchA workflow ID for leafA1 and leafA2 tasks', () => {
      const subOrchATask = allTasks.find(
        (t) => t.workflow_type === 'subOrchA',
      )!;
      const leafATasks = allTasks.filter((t) =>
        ['leafA1', 'leafA2'].includes(t.workflow_type),
      );
      expect(leafATasks).toHaveLength(2);

      for (const task of leafATasks) {
        expect(task.parent_id).toBe(subOrchATask.workflow_id);
      }
    });

    it('should set parentId to subOrchB workflow ID for leafB1, leafB2, leafB3 tasks', () => {
      const subOrchBTask = allTasks.find(
        (t) => t.workflow_type === 'subOrchB',
      )!;
      const leafBTasks = allTasks.filter((t) =>
        ['leafB1', 'leafB2', 'leafB3'].includes(t.workflow_type),
      );
      expect(leafBTasks).toHaveLength(3);

      for (const task of leafBTasks) {
        expect(task.parent_id).toBe(subOrchBTask.workflow_id);
      }
    });

    it('should allow reconstructing the full call tree from parentId relationships', () => {
      // Build adjacency list: parentId → children
      const childrenOf = new Map<string, LTTaskRecord[]>();
      for (const task of allTasks) {
        const pid = task.parent_id!;
        if (!childrenOf.has(pid)) childrenOf.set(pid, []);
        childrenOf.get(pid)!.push(task);
      }

      // Root level: top-level orchestrator's children
      const rootChildren = childrenOf.get(topOrchWorkflowId) || [];
      const rootChildTypes = rootChildren
        .map((t) => t.workflow_type)
        .sort();
      expect(rootChildTypes).toEqual(['subOrchA', 'subOrchB']);

      // Branch A: subOrchA's children
      const subOrchATask = allTasks.find(
        (t) => t.workflow_type === 'subOrchA',
      )!;
      const branchAChildren = childrenOf.get(subOrchATask.workflow_id) || [];
      const branchATypes = branchAChildren
        .map((t) => t.workflow_type)
        .sort();
      expect(branchATypes).toEqual(['leafA1', 'leafA2']);

      // Branch B: subOrchB's children
      const subOrchBTask = allTasks.find(
        (t) => t.workflow_type === 'subOrchB',
      )!;
      const branchBChildren = childrenOf.get(subOrchBTask.workflow_id) || [];
      const branchBTypes = branchBChildren
        .map((t) => t.workflow_type)
        .sort();
      expect(branchBTypes).toEqual(['leafB1', 'leafB2', 'leafB3']);

      // No other parent groups should exist
      expect(childrenOf.size).toBe(3); // topOrch, subOrchA, subOrchB
    });

    it('should allow finding every task in the hierarchy via a single originId query', () => {
      // All 7 tasks returned from a single origin_id query
      expect(allTasks.length).toBe(7);

      // Every task has the same origin_id
      const uniqueOrigins = new Set(allTasks.map((t) => t.origin_id));
      expect(uniqueOrigins.size).toBe(1);
      expect(uniqueOrigins.has(topOrchWorkflowId)).toBe(true);
    });

    it('should allow walking from any leaf up to the root via parentId', () => {
      // Walk from leafA1 → subOrchA → topOrchWorkflowId (no task, root)
      const leafA1Task = allTasks.find(
        (t) => t.workflow_type === 'leafA1',
      )!;
      const parentOfLeafA1 = allTasks.find(
        (t) => t.workflow_id === leafA1Task.parent_id,
      );
      expect(parentOfLeafA1).toBeTruthy();
      expect(parentOfLeafA1!.workflow_type).toBe('subOrchA');

      const parentOfSubOrchA = allTasks.find(
        (t) => t.workflow_id === parentOfLeafA1!.parent_id,
      );
      // subOrchA's parent_id is the top-level orchestrator, which has no task
      expect(parentOfSubOrchA).toBeUndefined();
      expect(parentOfLeafA1!.parent_id).toBe(topOrchWorkflowId);

      // Walk from leafB3 → subOrchB → topOrchWorkflowId (root)
      const leafB3Task = allTasks.find(
        (t) => t.workflow_type === 'leafB3',
      )!;
      const parentOfLeafB3 = allTasks.find(
        (t) => t.workflow_id === leafB3Task.parent_id,
      );
      expect(parentOfLeafB3).toBeTruthy();
      expect(parentOfLeafB3!.workflow_type).toBe('subOrchB');
      expect(parentOfLeafB3!.parent_id).toBe(topOrchWorkflowId);
    });
  });

  // ── Escalation path: leafB3 escalates, verify lineage on escalation ────────

  describe('escalation path (leafB3 escalates)', () => {
    let topOrchWorkflowId: string;
    let allTasks: LTTaskRecord[];

    beforeAll(async () => {
      topOrchWorkflowId = `test-hier-esc-${Durable.guid()}`;

      const handle = await client.workflow.start({
        args: [{
          data: { testId: 'hierarchy-escalation', escalateB3: true },
          metadata: {},
        }],
        taskQueue: TOP_ORCH_QUEUE,
        workflowName: 'topLevelOrch',
        workflowId: topOrchWorkflowId,
        expire: 300,
      });

      // Poll until the pipeline reaches the escalation point
      // (topLevel → subOrchA completes → subOrchB starts → leafB1,B2 complete → leafB3 escalates)
      const escalations = await waitForEscalationByOriginId(topOrchWorkflowId, 15_000, 2_000);
      const esc = escalations.find((e) =>
        e.description?.includes('Hierarchy test escalation'),
      );
      expect(esc).toBeTruthy();

      // Verify escalation has correct lineage
      expect(esc!.origin_id).toBe(topOrchWorkflowId);

      // parentId on the escalation should match leafB3's parent (subOrchB)
      const subOrchBTasks = await getTasksByOriginId(topOrchWorkflowId);
      const subOrchBTask = subOrchBTasks.find(
        (t) => t.workflow_type === 'subOrchB',
      );
      expect(subOrchBTask).toBeTruthy();
      expect(esc!.parent_id).toBe(subOrchBTask!.workflow_id);

      // Resolve the escalation
      await resolveEscalation(esc!.id, {
        approved: true,
        humanNote: 'Resolved in hierarchy test',
      });

      // Wait for the resolution to propagate back up the chain
      const result = await handle.result();
      expect(result).toBeTruthy();

      await sleepFor(1000);
      allTasks = await getTasksByOriginId(topOrchWorkflowId);
    }, 30_000);

    it('should still link all tasks via the same originId after escalation resolution', () => {
      expect(allTasks.length).toBe(7);

      for (const task of allTasks) {
        expect(task.origin_id).toBe(topOrchWorkflowId);
      }
    });

    it('should complete all tasks after escalation is resolved', () => {
      for (const task of allTasks) {
        expect(task.status).toBe('completed');
      }
    });

    it('should preserve the parentId hierarchy after escalation resolution', () => {
      const subOrchATask = allTasks.find(
        (t) => t.workflow_type === 'subOrchA',
      )!;
      const subOrchBTask = allTasks.find(
        (t) => t.workflow_type === 'subOrchB',
      )!;

      // Sub-orchestrators → top-level
      expect(subOrchATask.parent_id).toBe(topOrchWorkflowId);
      expect(subOrchBTask.parent_id).toBe(topOrchWorkflowId);

      // Branch A leaves → subOrchA
      for (const wfType of ['leafA1', 'leafA2']) {
        const task = allTasks.find((t) => t.workflow_type === wfType)!;
        expect(task.parent_id).toBe(subOrchATask.workflow_id);
      }

      // Branch B leaves → subOrchB
      for (const wfType of ['leafB1', 'leafB2', 'leafB3']) {
        const task = allTasks.find((t) => t.workflow_type === wfType)!;
        expect(task.parent_id).toBe(subOrchBTask.workflow_id);
      }
    });

    it('should set originId and parentId on the escalation record', async () => {
      // Find all escalations for leafB3 with this origin
      const { escalations } = await escalationService.listEscalations({
        type: 'leafB3',
      });
      const esc = escalations.find(
        (e) => e.origin_id === topOrchWorkflowId,
      );
      expect(esc).toBeTruthy();
      expect(esc!.status).toBe('resolved');
      expect(esc!.origin_id).toBe(topOrchWorkflowId);

      // parentId on escalation matches subOrchB (leafB3's parent)
      const subOrchBTask = allTasks.find(
        (t) => t.workflow_type === 'subOrchB',
      )!;
      expect(esc!.parent_id).toBe(subOrchBTask.workflow_id);
    });

    it('should include resolver data in the resolved leafB3 task', () => {
      const leafB3Task = allTasks.find(
        (t) => t.workflow_type === 'leafB3',
      )!;
      expect(leafB3Task.status).toBe('completed');

      const data = JSON.parse(leafB3Task.data!);
      expect(data.resolved).toBe(true);
      expect(data.resolution.humanNote).toBe('Resolved in hierarchy test');
    });
  });
});
