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

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.task.>`, () => {
    invalidate([['jobs']]);
  });

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.workflow.>`, () => {
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

    const parts = event.type.split('.');
    const category = parts[0] === 'system' ? parts[1] : parts[0];
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

    const parts = event.type.split('.');
    const category = parts[0] === 'system' ? parts[1] : parts[0];
    const keys = getInvalidationKeys(event);

    if (category === 'escalation') {
      keys.push(['escalations', 'by-workflow', workflowId]);
    }

    invalidate(keys);
  });
}

/**
 * Invalidate workflow set and YAML workflow queries when plan-related events fire.
 * Covers the planner workflow and all child builder workflows.
 */
export function usePlanDetailEvents(plannerWorkflowId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(400);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.>`, (event) => {
    if (!plannerWorkflowId) return;

    const isRelated = event.workflowId === plannerWorkflowId
      || event.workflowId?.includes(plannerWorkflowId);
    if (!isRelated) return;

    const keys = getInvalidationKeys(event);
    keys.push(['workflowSets']);
    keys.push(['yamlWorkflows']);
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

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.task.>`, handler);
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.workflow.>`, handler);
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.escalation.>`, handler);
}

/**
 * Invalidate escalation stats (EscalationsOverview) on escalation events.
 */
export function useEscalationStatsEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.escalation.>`, () => {
    invalidate([['escalationStats']]);
  });
}

/**
 * Invalidate station metrics (Operations page + station detail) on escalation
 * events. Push-driven only: escalation resolves/claims/creates are the sole
 * things that move the numbers, so the socket event is the complete refresh
 * signal. The 600ms debounce collapses a resolve burst into one refetch.
 */
export function useStationMetricsEvents(): void {
  const invalidate = useDebouncedInvalidation(600);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.escalation.>`, () => {
    invalidate([['stationMetrics']]);
  });
}

/**
 * Invalidate escalation list queries on escalation events.
 */
export function useEscalationListEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.escalation.>`, () => {
    invalidate([['escalations']]);
  });
}

/**
 * Invalidate a single escalation detail on escalation events for that ID.
 */
export function useEscalationDetailEvents(escalationId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.escalation.>`, (event) => {
    if (!escalationId) return;
    if (event.escalationId === escalationId) {
      invalidate([['escalations', escalationId], ['escalations'], ['escalationStats']]);
    }
  });
}

/**
 * Invalidate agent queries on agent lifecycle events.
 */
export function useAgentEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.agent.>`, () => {
    invalidate([['agents']]);
  });
}

/**
 * Invalidate knowledge queries on knowledge events.
 */
export function useKnowledgeEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.knowledge.>`, () => {
    invalidate([['knowledge']]);
  });
}

/**
 * Invalidate process list (ProcessesListPage) on task/workflow events.
 */
export function useProcessListEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.task.>`, () => {
    invalidate([['processes']]);
  });

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.workflow.>`, () => {
    invalidate([['processes']]);
  });
}
