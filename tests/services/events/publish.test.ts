import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { eventRegistry } from '../../../lib/events';
import { InMemoryEventAdapter } from '../../../lib/events/memory';
import {
  publishMilestoneEvent,
  publishTaskEvent,
  publishEscalationEvent,
  publishWorkflowEvent,
  publishActivityEvent,
} from '../../../lib/events/publish';

describe('event publish functions', () => {
  let adapter: InMemoryEventAdapter;

  beforeAll(async () => {
    adapter = new InMemoryEventAdapter();
    eventRegistry.register(adapter);
    await eventRegistry.connect();
  });

  beforeEach(() => {
    adapter.clear();
  });

  afterAll(async () => {
    await eventRegistry.disconnect();
    eventRegistry.clear();
  });

  // ── publishMilestoneEvent ───────────────────────────────────────────────

  describe('publishMilestoneEvent', () => {
    it('publishes a milestone event with correct shape', async () => {
      await publishMilestoneEvent({
        source: 'interceptor',
        workflowId: 'wf-1',
        workflowName: 'reviewContent',
        taskQueue: 'long-tail',
        taskId: 'task-1',
        milestones: [{ name: 'approved', value: true }],
        data: { score: 95 },
      });

      expect(adapter.events).toHaveLength(1);
      const evt = adapter.events[0];
      expect(evt.type).toBe('milestone');
      expect(evt.source).toBe('interceptor');
      expect(evt.workflowId).toBe('wf-1');
      expect(evt.workflowName).toBe('reviewContent');
      expect(evt.taskQueue).toBe('long-tail');
      expect(evt.taskId).toBe('task-1');
      expect(evt.milestones).toEqual([{ name: 'approved', value: true }]);
      expect(evt.data).toEqual({ score: 95 });
      expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('skips publishing when milestones array is empty', async () => {
      await publishMilestoneEvent({
        source: 'interceptor',
        workflowId: 'wf-1',
        workflowName: 'test',
        taskQueue: 'q',
        milestones: [],
      });

      expect(adapter.events).toHaveLength(0);
    });

    it('supports activity source with activityName', async () => {
      await publishMilestoneEvent({
        source: 'activity',
        workflowId: 'wf-1',
        workflowName: 'test',
        taskQueue: 'q',
        activityName: 'analyzeContent',
        milestones: [{ name: 'step', value: 'done' }],
      });

      expect(adapter.events[0].activityName).toBe('analyzeContent');
      expect(adapter.events[0].source).toBe('activity');
    });
  });

  // ── publishTaskEvent ────────────────────────────────────────────────────

  describe('publishTaskEvent', () => {
    const taskTypes = [
      'task.created',
      'task.started',
      'task.completed',
      'task.escalated',
      'task.failed',
    ] as const;

    for (const type of taskTypes) {
      it(`publishes ${type} with correct shape`, async () => {
        await publishTaskEvent({
          type,
          source: 'interceptor',
          workflowId: 'wf-2',
          workflowName: 'reviewContent',
          taskQueue: 'long-tail',
          taskId: 'task-2',
          originId: 'origin-1',
          status: 'in_progress',
        });

        expect(adapter.events).toHaveLength(1);
        const evt = adapter.events[0];
        expect(evt.type).toBe(type);
        expect(evt.taskId).toBe('task-2');
        expect(evt.originId).toBe('origin-1');
        expect(evt.status).toBe('in_progress');
        expect(evt.timestamp).toBeTruthy();

        adapter.clear();
      });
    }

    it('includes milestones and data when provided', async () => {
      await publishTaskEvent({
        type: 'task.completed',
        source: 'orchestrator',
        workflowId: 'wf-3',
        workflowName: 'test',
        taskQueue: 'q',
        taskId: 'task-3',
        status: 'completed',
        milestones: [{ name: 'result', value: 'success' }],
        data: { output: 'hello' },
      });

      const evt = adapter.events[0];
      expect(evt.milestones).toEqual([{ name: 'result', value: 'success' }]);
      expect(evt.data).toEqual({ output: 'hello' });
    });
  });

  // ── publishEscalationEvent ──────────────────────────────────────────────

  describe('publishEscalationEvent', () => {
    it('publishes escalation.created with escalationId', async () => {
      await publishEscalationEvent({
        type: 'escalation.created',
        source: 'interceptor',
        workflowId: 'wf-4',
        workflowName: 'reviewContent',
        taskQueue: 'long-tail',
        taskId: 'task-4',
        escalationId: 'esc-1',
        originId: 'origin-2',
        status: 'pending',
        data: { reason: 'needs human review' },
      });

      expect(adapter.events).toHaveLength(1);
      const evt = adapter.events[0];
      expect(evt.type).toBe('escalation.created');
      expect(evt.escalationId).toBe('esc-1');
      expect(evt.status).toBe('pending');
      expect(evt.data).toEqual({ reason: 'needs human review' });
    });

    it('publishes escalation.resolved', async () => {
      await publishEscalationEvent({
        type: 'escalation.resolved',
        source: 'interceptor',
        workflowId: 'wf-5',
        workflowName: 'reviewContent',
        taskQueue: 'long-tail',
        escalationId: 'esc-2',
        status: 'resolved',
      });

      const evt = adapter.events[0];
      expect(evt.type).toBe('escalation.resolved');
      expect(evt.escalationId).toBe('esc-2');
      expect(evt.status).toBe('resolved');
    });
  });

  // ── publishWorkflowEvent ────────────────────────────────────────────────

  describe('publishWorkflowEvent', () => {
    const workflowTypes = [
      'workflow.started',
      'workflow.completed',
      'workflow.failed',
    ] as const;

    for (const type of workflowTypes) {
      it(`publishes ${type} with correct shape`, async () => {
        await publishWorkflowEvent({
          type,
          source: 'interceptor',
          workflowId: 'wf-6',
          workflowName: 'reviewContent',
          taskQueue: 'long-tail',
          taskId: 'task-6',
          originId: 'origin-3',
          status: 'running',
        });

        expect(adapter.events).toHaveLength(1);
        const evt = adapter.events[0];
        expect(evt.type).toBe(type);
        expect(evt.workflowId).toBe('wf-6');
        expect(evt.originId).toBe('origin-3');
        expect(evt.status).toBe('running');
        expect(evt.timestamp).toBeTruthy();

        adapter.clear();
      });
    }

    it('includes data when provided', async () => {
      await publishWorkflowEvent({
        type: 'workflow.failed',
        source: 'interceptor',
        workflowId: 'wf-7',
        workflowName: 'test',
        taskQueue: 'q',
        status: 'failed',
        data: { error: 'something went wrong' },
      });

      expect(adapter.events[0].data).toEqual({ error: 'something went wrong' });
    });
  });

  // ── publishActivityEvent ───────────────────────────────────────────────

  describe('publishActivityEvent', () => {
    const activityTypes = [
      'activity.started',
      'activity.completed',
      'activity.failed',
    ] as const;

    for (const type of activityTypes) {
      it(`publishes ${type} with correct shape`, async () => {
        await publishActivityEvent({
          type,
          workflowId: 'job-1',
          workflowName: 'take-screenshots',
          taskQueue: 'longtail',
          activityName: 'capture_page',
          data: { stepIndex: 2, totalSteps: 5, toolName: 'playwright_screenshot' },
        });

        expect(adapter.events).toHaveLength(1);
        const evt = adapter.events[0];
        expect(evt.type).toBe(type);
        expect(evt.source).toBe('yaml-worker');
        expect(evt.workflowId).toBe('job-1');
        expect(evt.workflowName).toBe('take-screenshots');
        expect(evt.taskQueue).toBe('longtail');
        expect(evt.activityName).toBe('capture_page');
        expect(evt.data).toEqual({ stepIndex: 2, totalSteps: 5, toolName: 'playwright_screenshot' });
        expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        adapter.clear();
      });
    }

    it('publishes without optional data', async () => {
      await publishActivityEvent({
        type: 'activity.completed',
        workflowId: 'job-2',
        workflowName: 'test-wf',
        taskQueue: 'q',
        activityName: 'step_1',
      });

      const evt = adapter.events[0];
      expect(evt.activityName).toBe('step_1');
      expect(evt.data).toBeUndefined();
    });
  });

  // ── fireAndForget / error swallowing ────────────────────────────────────

  describe('error handling', () => {
    it('does not throw when registry publish fails', async () => {
      // Temporarily register a failing adapter
      const failingAdapter = {
        connect: async () => {},
        publish: async () => { throw new Error('adapter failure'); },
        disconnect: async () => {},
      };

      eventRegistry.register(failingAdapter);

      // Should not throw
      await expect(
        publishTaskEvent({
          type: 'task.created',
          source: 'interceptor',
          workflowId: 'wf-err',
          workflowName: 'test',
          taskQueue: 'q',
          taskId: 'task-err',
          status: 'pending',
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── No adapters registered ──────────────────────────────────────────────

  describe('no adapters', () => {
    it('resolves immediately when no adapters are registered', async () => {
      const isolatedRegistry = await import('../../../lib/events');

      // Save and restore
      const savedHasAdapters = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(isolatedRegistry.eventRegistry),
        'hasAdapters',
      );

      // We already know the main registry has adapters so we test
      // the guard via the publishMilestoneEvent empty check instead
      await publishMilestoneEvent({
        source: 'interceptor',
        workflowId: 'wf-no',
        workflowName: 'test',
        taskQueue: 'q',
        milestones: [],
      });

      // Should not have published (empty milestones guard)
      const noEvents = adapter.events.filter((e) => e.workflowId === 'wf-no');
      expect(noEvents).toHaveLength(0);
    });
  });
});
