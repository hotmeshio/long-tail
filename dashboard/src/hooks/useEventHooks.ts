import { useRef, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEventSubscription, useEventSubscriptions } from './useEventContext';
import { getInvalidationKeys } from '../lib/events/invalidation';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';
import { escalationPattern, escalationPatterns, type EscalationVerb } from '../lib/events/subjects';

/**
 * Throttled query invalidation. Collects query keys over a window and fires
 * a single batch invalidation per window — at most one refetch per delayMs,
 * and under a constant event stream at least one per delayMs too.
 *
 * The FIRST event opens the window; later events accumulate keys without
 * touching the timer. Resetting the timer per event (a trailing debounce)
 * would starve forever under sustained load — the flush would wait for a
 * quiet gap that high-throughput surfaces never produce.
 */
function useDebouncedInvalidation(delayMs = 500) {
  const qc = useQueryClient();
  const pendingKeys = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback((keys: string[][]) => {
    for (const key of keys) {
      pendingKeys.current.add(JSON.stringify(key));
    }

    if (timer.current) return; // window open — the pending flush carries these
    timer.current = setTimeout(() => {
      timer.current = null;
      const batch = [...pendingKeys.current];
      pendingKeys.current.clear();
      for (const raw of batch) {
        qc.invalidateQueries({ queryKey: JSON.parse(raw) });
      }
    }, delayMs);
  }, [qc, delayMs]);
}

/**
 * The subject slice a workflow-detail surface needs. Workflow, activity, and
 * milestone subjects embed the workflowId, so those levels pin exactly; task
 * and escalation subjects embed their own ids, so those two families arrive
 * family-wide and the handler's workflowId check filters them. Detail pages
 * for related/derived jobs (`rerun-<id>`, `triage-<id>`) match by inclusion,
 * so the workflow family also stays wide.
 */
function workflowDetailPatterns(workflowId: string | undefined): string[] {
  if (!workflowId) return [];
  return [
    `${NATS_SUBJECT_PREFIX}.system.workflow.>`,
    `${NATS_SUBJECT_PREFIX}.system.activity.>`,
    `${NATS_SUBJECT_PREFIX}.system.milestone.>`,
    `${NATS_SUBJECT_PREFIX}.system.task.>`,
    `${NATS_SUBJECT_PREFIX}.system.escalation.>`,
  ];
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

  useEventSubscriptions(workflowDetailPatterns(workflowId), (event) => {
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

  useEventSubscriptions(workflowDetailPatterns(workflowId), (event) => {
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

  useEventSubscriptions(workflowDetailPatterns(plannerWorkflowId), (event) => {
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
 * Stats aggregate every role and verb, so the family-wide pattern is the
 * honest scope here.
 */
export function useEscalationStatsEvents(): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(escalationPattern({}), () => {
    invalidate([['escalationStats']]);
  });
}

/**
 * Invalidate station metrics (Operations page + station detail) on escalation
 * events. Push-driven only: escalation lifecycle moments are the sole things
 * that move the numbers, so the event is the complete refresh signal. The
 * board is a summary surface, so the debounce is generous — a high-throughput
 * burst collapses into at most one refetch every 1.5s.
 */
export function useStationMetricsEvents(): void {
  const invalidate = useDebouncedInvalidation(1500);

  useEventSubscription(escalationPattern({}), () => {
    invalidate([['stationMetrics']]);
  });
}

/**
 * Invalidate escalation list queries on escalation events.
 *
 * List pages pass the slice they render: `role` narrows to one queue's
 * subject token, `verbs` to the lifecycle moments that change the list.
 * Omitted, the subscription spans the escalation family — for summary
 * surfaces that genuinely aggregate everything.
 */
export function useEscalationListEvents(scope?: {
  role?: string | null;
  verbs?: EscalationVerb[];
}): void {
  const invalidate = useDebouncedInvalidation(300);
  const role = scope?.role ?? null;
  const verbsKey = (scope?.verbs ?? []).join(',');

  const patterns = useMemo(() => {
    const verbs = verbsKey ? (verbsKey.split(',') as EscalationVerb[]) : null;
    return verbs
      ? escalationPatterns({ role, verbs })
      : [escalationPattern({ role })];
  }, [role, verbsKey]);

  useEventSubscriptions(patterns, () => {
    invalidate([['escalations']]);
  });
}

/**
 * Invalidate a single escalation detail on that item's own events. The id is
 * the subject's fourth token, so the broker delivers exactly this item's
 * lifecycle — across role hops (`system.escalation.*.{id}.>`).
 */
export function useEscalationDetailEvents(escalationId: string | undefined): void {
  const invalidate = useDebouncedInvalidation(300);

  useEventSubscription(
    escalationId
      ? escalationPattern({ id: escalationId })
      : escalationPattern({ id: '__none__' }),
    (event) => {
      if (!escalationId || event.escalationId !== escalationId) return;
      invalidate([['escalations', escalationId], ['escalations'], ['escalationStats']]);
    },
  );
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
