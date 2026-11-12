import { describe, it, expect } from 'vitest';

import { summarizeExecution } from '../../../services/durable-provider/summary';
import type { LTWorkflowExecutionEvent } from '../../../types/durable-provider';

let nextId = 1;
function event(event_type: string, category: LTWorkflowExecutionEvent['category'], is_system = false): LTWorkflowExecutionEvent {
  return { event_id: nextId++, event_type, category, event_time: '2026-11-11T00:00:00.000Z', duration_ms: null, is_system, attributes: { kind: event_type } };
}

describe('summarizeExecution', () => {
  it('counts activities by outcome and by system or user', () => {
    const summary = summarizeExecution([
      event('activity_task_scheduled', 'activity'),
      event('activity_task_completed', 'activity'),
      event('activity_task_scheduled', 'activity', true),
      event('activity_task_failed', 'activity', true),
    ]);
    expect(summary.activities).toEqual({ total: 2, completed: 1, failed: 1, system: 1, user: 1 });
    expect(summary.total_events).toBe(4);
  });

  it('counts children, timers and signals', () => {
    const summary = summarizeExecution([
      event('child_workflow_execution_started', 'child_workflow'),
      event('child_workflow_execution_completed', 'child_workflow'),
      event('timer_started', 'timer'),
      event('signal_wait_started', 'signal'),
      event('workflow_execution_signaled', 'signal'),
    ]);
    expect(summary.child_workflows).toEqual({ total: 1, completed: 1, failed: 0 });
    expect(summary.timers).toBe(1);
    expect(summary.signals).toBe(1);
  });

  it('returns zeros for an empty timeline', () => {
    const summary = summarizeExecution([]);
    expect(summary.total_events).toBe(0);
    expect(summary.activities.total).toBe(0);
  });
});
