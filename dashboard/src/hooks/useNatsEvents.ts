import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNatsSubscription } from './useNats';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';

/**
 * Debounced query invalidation. Collects query keys over a window
 * and fires a single batch invalidation, preventing rapid re-renders
 * when multiple NATS events arrive in quick succession.
 */
function useDebouncedInvalidation(delayMs = 500) {
  const qc = useQueryClient();
  const pendingKeys = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback((keys: string[][]) => {
    for (const key of keys) {
      pendingKeys.current.add(JSON.stringify(key));
    }

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      for (const raw of pendingKeys.current) {
        qc.invalidateQueries({ queryKey: JSON.parse(raw) });
      }
      pendingKeys.current.clear();
      timer.current = null;
    }, delayMs);
  }, [qc, delayMs]);
}

/**
 * Invalidate workflow list queries (WorkflowsDashboard) on task/workflow events.
 */
export function useWorkflowListEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.task.>`, () => {
    invalidate([['jobs']]);
  });

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.workflow.>`, () => {
    invalidate([['jobs']]);
  });
}

/**
 * Invalidate queries for a specific workflow execution page.
 *
 * Events are debounced: a burst of task.created + workflow.started +
 * task.started (typical on workflow launch) triggers a single refetch
 * instead of 15 separate API calls.
 *
 * Only the queries relevant to the event category are invalidated:
 * - task/workflow/milestone events → execution timeline + state
 * - escalation events → escalation list for this workflow
 */
export function useWorkflowDetailEvents(workflowId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(400);

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.>`, (event) => {
    if (!workflowId) return;

    // Child workflow IDs contain the parent orchestrator ID as a substring,
    // e.g. parent = "myOrchestrator-abc123", child = "myTask-myOrchestrator-abc123-2"
    const isRelated = event.workflowId === workflowId
      || event.workflowId?.includes(workflowId);
    if (!isRelated) return;

    const category = event.type.split('.')[0];

    if (category === 'escalation') {
      invalidate([['escalations', 'by-workflow', workflowId]]);
    } else {
      // task.*, workflow.*, milestone → refresh timeline + state
      invalidate([
        ['workflowExecution', workflowId],
        ['workflowState', workflowId],
        ['tasks', 'children', workflowId],
      ]);
    }
  });
}

/**
 * Invalidate escalation stats (EscalationsOverview) on escalation events.
 */
export function useEscalationStatsEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, () => {
    invalidate([['escalationStats']]);
  });
}

/**
 * Invalidate escalation list queries on escalation events.
 */
export function useEscalationListEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, () => {
    invalidate([['escalations']]);
  });
}

/**
 * Invalidate a single escalation detail on escalation events for that ID.
 */
export function useEscalationDetailEvents(escalationId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(300);

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, (event) => {
    if (!escalationId) return;
    if (event.escalationId === escalationId) {
      invalidate([['escalations', escalationId], ['escalations'], ['escalationStats']]);
    }
  });
}

/**
 * Invalidate process list (ProcessesListPage) on task/workflow events.
 */
export function useProcessListEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.task.>`, () => {
    invalidate([['processes']]);
  });

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.workflow.>`, () => {
    invalidate([['processes']]);
  });
}
