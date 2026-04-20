import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEventSubscription } from './useEventContext';
import { getInvalidationKeys } from '../lib/events/invalidation';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';

/**
 * Debounced query invalidation. Collects query keys over a window
 * and fires a single batch invalidation, preventing rapid re-renders
 * when multiple events arrive in quick succession.
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

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.task.>`, () => {
    invalidate([['jobs']]);
  });

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.workflow.>`, () => {
    invalidate([['jobs']]);
  });
}

/**
 * Invalidate queries for a specific workflow execution page (durable workflows).
 *
 * Uses the centralized `getInvalidationKeys` mapping plus escalation-specific
 * keys for the detail view. Events are debounced to prevent flurries of re-renders.
 */
export function useWorkflowDetailEvents(workflowId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(400);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.>`, (event) => {
    if (!workflowId) return;

    const isRelated = event.workflowId === workflowId
      || event.workflowId?.includes(workflowId);
    if (!isRelated) return;

    const category = event.type.split('.')[0];
    const keys = getInvalidationKeys(event);

    if (category === 'escalation') {
      keys.push(['escalations', 'by-workflow', workflowId]);
    }

    invalidate(keys);
  });
}

/**
 * Invalidate queries for mcpQuery/builder detail pages.
 *
 * Covers: mcpQueryExecution, mcpQueryResult, builderResult, workflowExecution,
 * workflowState, and escalation keys. Replaces polling on these pages.
 */
export function useMcpQueryDetailEvents(workflowId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(400);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.>`, (event) => {
    if (!workflowId) return;

    const isRelated = event.workflowId === workflowId
      || event.workflowId?.includes(workflowId);
    if (!isRelated) return;

    const category = event.type.split('.')[0];
    const keys = getInvalidationKeys(event);

    if (category === 'escalation') {
      keys.push(['escalations', 'by-workflow', workflowId]);
    }

    invalidate(keys);
  });
}

/**
 * Invalidate process detail queries on task/workflow events for a specific origin.
 */
export function useProcessDetailEvents(originId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(300);

  const handler = useCallback((event: any) => {
    if (!originId) return;
    if (event.originId !== originId && event.workflowId !== originId) return;
    invalidate([['processes', originId]]);
  }, [originId, invalidate]);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.task.>`, handler);
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.workflow.>`, handler);
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, handler);
}

/**
 * Invalidate escalation stats (EscalationsOverview) on escalation events.
 */
export function useEscalationStatsEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, () => {
    invalidate([['escalationStats']]);
  });
}

/**
 * Invalidate escalation list queries on escalation events.
 */
export function useEscalationListEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, () => {
    invalidate([['escalations']]);
  });
}

/**
 * Invalidate a single escalation detail on escalation events for that ID.
 */
export function useEscalationDetailEvents(escalationId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, (event) => {
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

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.task.>`, () => {
    invalidate([['processes']]);
  });

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.workflow.>`, () => {
    invalidate([['processes']]);
  });
}
