import { describe, it, expect } from 'vitest';
import { getInvalidationKeys } from '../invalidation';
import type { NatsLTEvent } from '../../nats/types';

function makeEvent(overrides: Partial<NatsLTEvent>): NatsLTEvent {
  return {
    type: 'task.created',
    source: 'interceptor',
    workflowId: 'wf-1',
    workflowName: 'reviewContent',
    taskQueue: 'long-tail',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('getInvalidationKeys', () => {
  describe('task events', () => {
    const taskTypes = ['task.created', 'task.started', 'task.completed', 'task.escalated', 'task.failed'];

    for (const type of taskTypes) {
      it(`invalidates tasks, jobs, processes, and workflow-specific keys for ${type}`, () => {
        const keys = getInvalidationKeys(makeEvent({ type, workflowId: 'wf-abc' }));

        expect(keys).toContainEqual(['tasks']);
        expect(keys).toContainEqual(['jobs']);
        expect(keys).toContainEqual(['processes']);
        expect(keys).toContainEqual(['workflowExecution', 'wf-abc']);
        expect(keys).toContainEqual(['workflowState', 'wf-abc']);
        expect(keys).toContainEqual(['mcpQueryExecution', 'wf-abc']);
      });
    }

    it('invalidates process-specific key when originId is present', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'task.completed', workflowId: 'wf-1', originId: 'proc-abc' }));

      expect(keys).toContainEqual(['processes', 'proc-abc']);
    });

    it('omits workflow-specific keys when workflowId is empty', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'task.created', workflowId: '' }));

      expect(keys).toContainEqual(['tasks']);
      expect(keys).toContainEqual(['jobs']);
      expect(keys).not.toContainEqual(expect.arrayContaining(['workflowExecution']));
    });
  });

  describe('escalation events', () => {
    it('invalidates escalations and escalationStats for escalation.created', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'escalation.created', workflowId: 'wf-x' }));

      expect(keys).toContainEqual(['escalations']);
      expect(keys).toContainEqual(['escalationStats']);
      expect(keys).toContainEqual(['workflowExecution', 'wf-x']);
      // Should NOT include jobs or tasks
      expect(keys).not.toContainEqual(['jobs']);
      expect(keys).not.toContainEqual(['tasks']);
    });

    it('invalidates escalations and escalationStats for escalation.resolved', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'escalation.resolved' }));

      expect(keys).toContainEqual(['escalations']);
      expect(keys).toContainEqual(['escalationStats']);
    });
  });

  describe('workflow events', () => {
    const workflowTypes = ['workflow.started', 'workflow.completed', 'workflow.failed'];

    for (const type of workflowTypes) {
      it(`invalidates jobs, tasks, processes, and workflow-specific keys for ${type}`, () => {
        const keys = getInvalidationKeys(makeEvent({ type, workflowId: 'wf-99' }));

        expect(keys).toContainEqual(['jobs']);
        expect(keys).toContainEqual(['tasks']);
        expect(keys).toContainEqual(['processes']);
        expect(keys).toContainEqual(['workflowExecution', 'wf-99']);
        expect(keys).toContainEqual(['workflowState', 'wf-99']);
      });

      it(`invalidates mcpQuery and builder result keys for ${type}`, () => {
        const keys = getInvalidationKeys(makeEvent({ type, workflowId: 'wf-99' }));

        expect(keys).toContainEqual(['mcpQueryExecution', 'wf-99']);
        expect(keys).toContainEqual(['mcpQueryResult', 'wf-99']);
        expect(keys).toContainEqual(['builderResult', 'wf-99']);
      });
    }
  });

  describe('milestone events', () => {
    it('invalidates workflow execution, mcpQueryExecution, and tasks', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'milestone', workflowId: 'wf-m' }));

      expect(keys).toContainEqual(['workflowExecution', 'wf-m']);
      expect(keys).toContainEqual(['mcpQueryExecution', 'wf-m']);
      expect(keys).toContainEqual(['tasks']);
      expect(keys).not.toContainEqual(['jobs']);
    });

    it('only invalidates tasks when workflowId is empty', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'milestone', workflowId: '' }));

      expect(keys).toContainEqual(['tasks']);
      expect(keys).toHaveLength(1);
    });
  });

  describe('activity events', () => {
    const activityTypes = ['activity.started', 'activity.completed', 'activity.failed'];

    for (const type of activityTypes) {
      it(`invalidates mcpRunExecution and mcpRuns for ${type}`, () => {
        const keys = getInvalidationKeys(makeEvent({ type, workflowId: 'job-1' }));

        expect(keys).toContainEqual(['mcpRunExecution', 'job-1']);
        expect(keys).toContainEqual(['mcpRuns']);
        // Should NOT include jobs or tasks (these are YAML worker events, not durable)
        expect(keys).not.toContainEqual(['jobs']);
        expect(keys).not.toContainEqual(['tasks']);
      });
    }

    it('only invalidates mcpRuns when workflowId is empty', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'activity.completed', workflowId: '' }));

      expect(keys).toContainEqual(['mcpRuns']);
      expect(keys).toHaveLength(1);
    });
  });

  describe('unknown events', () => {
    it('falls back to invalidating jobs and tasks for unknown event types', () => {
      const keys = getInvalidationKeys(makeEvent({ type: 'custom.something' }));

      expect(keys).toContainEqual(['jobs']);
      expect(keys).toContainEqual(['tasks']);
      expect(keys).toHaveLength(2);
    });
  });
});
