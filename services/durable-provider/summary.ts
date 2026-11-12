import type { LTWorkflowExecutionEvent, LTWorkflowExecutionSummary } from '../../types/durable-provider';

const COMPLETED = /_completed$/;
const FAILED = /_failed$|_timed_out$/;

/** Summary counts for a timeline, so every provider reports them the same way. */
export function summarizeExecution(events: LTWorkflowExecutionEvent[]): LTWorkflowExecutionSummary {
  const summary: LTWorkflowExecutionSummary = {
    total_events: events.length,
    activities: { total: 0, completed: 0, failed: 0, system: 0, user: 0 },
    child_workflows: { total: 0, completed: 0, failed: 0 },
    timers: 0,
    signals: 0,
  };
  for (const event of events) {
    if (event.category === 'activity') {
      if (event.event_type === 'activity_task_scheduled') {
        summary.activities.total++;
        if (event.is_system) summary.activities.system++;
        else summary.activities.user++;
      } else if (COMPLETED.test(event.event_type)) summary.activities.completed++;
      else if (FAILED.test(event.event_type)) summary.activities.failed++;
    } else if (event.category === 'child_workflow') {
      if (event.event_type === 'child_workflow_execution_started') summary.child_workflows.total++;
      else if (COMPLETED.test(event.event_type)) summary.child_workflows.completed++;
      else if (FAILED.test(event.event_type)) summary.child_workflows.failed++;
    } else if (event.category === 'timer' && event.event_type === 'timer_started') {
      summary.timers++;
    } else if (event.category === 'signal' && event.event_type === 'workflow_execution_signaled') {
      summary.signals++;
    }
  }
  return summary;
}
