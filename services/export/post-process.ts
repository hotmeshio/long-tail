import type { WorkflowExecution } from '@hotmeshio/hotmesh/build/types/exporter';

/**
 * Post-process execution events to improve timeline visualization:
 *
 * 1. Fire-and-forget child starts (`startChild`): set duration_ms = 0
 *    so they render as a narrow completed band instead of pending.
 *
 * 2. Completed signals (`waitFor` that received a signal): split into
 *    signal_wait_started + workflow_execution_signaled pair so the
 *    timeline can show the full wait duration as a band.
 *
 * 3. Running workflows: inject a pending signal_wait_started event
 *    after any fire-and-forget start that lacks a matching signal,
 *    so the timeline shows a growing orange "pending" band.
 */
export function postProcessExecution(execution: WorkflowExecution): WorkflowExecution {
  const events: WorkflowExecution['events'] = execution.events.map((e) => ({
    ...e,
    attributes: { ...e.attributes },
  }));
  const isRunning = !events.some(
    (e) =>
      e.event_type === 'workflow_execution_completed' ||
      e.event_type === 'workflow_execution_failed',
  );
  let nextId =
    events.length > 0 ? Math.max(...events.map((e) => e.event_id)) + 1 : 1;
  const toAdd: WorkflowExecution['events'] = [];

  // Enrich ltSignalParent activities with the workflow result as their payload.
  // The activity returns void, but it sends execution.result to the parent --
  // surfacing this makes the signal content visible in the UI.
  let enriched = false;
  if (execution.result) {
    for (const evt of events) {
      const attrs = evt.attributes as any;
      if (
        evt.event_type === 'activity_task_completed' &&
        attrs.activity_type === 'ltSignalParent' &&
        (attrs.result === undefined || attrs.result === null)
      ) {
        attrs.result = execution.result;
        enriched = true;
      }
    }
  }

  // Existing signal completions and wait-start events (keyed by timeline_key)
  const signalKeys = new Set(
    events
      .filter((e) => e.event_type === 'workflow_execution_signaled')
      .map((e) => (e.attributes as any).timeline_key as string)
      .filter(Boolean),
  );
  const existingWaitStarts = new Set(
    events
      .filter((e) => (e.event_type as string) === 'signal_wait_started')
      .map((e) => (e.attributes as any).timeline_key as string)
      .filter(Boolean),
  );

  for (const evt of events) {
    const attrs = evt.attributes as any;

    // 1. Fire-and-forget starts: completed instantly
    if (
      evt.event_type === 'child_workflow_execution_started' &&
      attrs.awaited === false &&
      evt.duration_ms === null
    ) {
      evt.duration_ms = 0;
    }

    // 2. Completed signals: inject signal_wait_started before completion
    if (
      evt.event_type === 'workflow_execution_signaled' &&
      evt.duration_ms != null &&
      evt.duration_ms > 0 &&
      attrs.timeline_key &&
      !existingWaitStarts.has(attrs.timeline_key)
    ) {
      const waitStartTime = new Date(
        new Date(evt.event_time).getTime() - evt.duration_ms,
      ).toISOString();
      toAdd.push({
        event_id: nextId++,
        event_type: 'signal_wait_started',
        category: 'signal',
        event_time: waitStartTime,
        duration_ms: null,
        is_system: false,
        attributes: {
          kind: 'signal_wait_started',
          signal_name: attrs.signal_name,
          timeline_key: attrs.timeline_key,
          execution_index: attrs.execution_index,
        },
      } as unknown as WorkflowExecution['events'][number]);
    }
  }

  // 3. Running workflows: inject pending waits after unmatched fire-and-forget starts
  if (isRunning) {
    for (const evt of events) {
      const attrs = evt.attributes as any;
      if (
        evt.event_type === 'child_workflow_execution_started' &&
        attrs.awaited === false
      ) {
        const startIndex = attrs.execution_index as number;
        const childId = attrs.child_workflow_id as string;
        const waitIndex = startIndex + 1;
        const waitKey = `-wait-${waitIndex}-`;

        if (!signalKeys.has(waitKey) && !existingWaitStarts.has(waitKey)) {
          toAdd.push({
            event_id: nextId++,
            event_type: 'signal_wait_started',
            category: 'signal',
            event_time: evt.event_time,
            duration_ms: null,
            is_system: false,
            attributes: {
              kind: 'signal_wait_started',
              signal_name: `lt-result-${childId}`,
              timeline_key: waitKey,
              execution_index: waitIndex,
            },
          } as unknown as WorkflowExecution['events'][number]);
        }
      }
    }
  }

  if (toAdd.length === 0 && !enriched) return execution;

  if (toAdd.length === 0) {
    return { ...execution, events };
  }

  events.push(...toAdd);

  // Re-sort chronologically and re-number
  events.sort((a, b) => {
    const cmp = a.event_time.localeCompare(b.event_time);
    return cmp !== 0 ? cmp : a.event_id - b.event_id;
  });
  for (let i = 0; i < events.length; i++) {
    events[i].event_id = i + 1;
  }

  return {
    ...execution,
    events,
    summary: {
      ...execution.summary,
      total_events: events.length,
    },
  };
}
