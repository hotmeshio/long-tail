import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEventSubscription, useEventSubscriptions } from './useEventContext';
import { getInvalidationKeys } from '../lib/events/invalidation';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';
import { escalationPattern, escalationPatterns, type EscalationVerb } from '../lib/events/subjects';
import { getInvalidationScheduler, type RefreshTier } from '../lib/realtime-refresh';

/**
 * Tier-bounded query invalidation through the ONE shared scheduler
 * (lib/realtime-refresh.ts): bursts coalesce into a single flush, a
 * refractory floor caps the sustained refetch rate per tier, identical keys
 * requested by several hooks invalidate once, and hidden tabs mark stale
 * without touching the network.
 */
export function useThrottledInvalidation(tier: RefreshTier) {
  const qc = useQueryClient();
  return useCallback((keys: string[][]) => {
    getInvalidationScheduler(qc).request(tier, keys);
  }, [qc, tier]);
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
  const invalidate = useThrottledInvalidation('LIST');

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
 * keys for the detail view. Events flush through the DETAIL tier.
 */
export function useWorkflowDetailEvents(workflowId: string | undefined): void {
  const invalidate = useThrottledInvalidation('DETAIL');

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
  const invalidate = useThrottledInvalidation('DETAIL');

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
  const invalidate = useThrottledInvalidation('DETAIL');

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
  const invalidate = useThrottledInvalidation('DETAIL');

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
  const invalidate = useThrottledInvalidation('SUMMARY');

  useEventSubscription(escalationPattern({}), () => {
    invalidate([['escalationStats']]);
  });
}

/**
 * Invalidate station metrics (Operations page + station detail) on escalation
 * events. Push-driven only: escalation lifecycle moments are the sole things
 * that move the numbers, so the event is the complete refresh signal. The
 * board is a summary surface — the SUMMARY tier bounds a high-throughput
 * stream to one refetch per refractory window.
 */
export function useStationMetricsEvents(): void {
  const invalidate = useThrottledInvalidation('SUMMARY');

  useEventSubscription(escalationPattern({}), () => {
    invalidate([['stationMetrics']]);
  });
}

/**
 * Invalidate the analytics aggregates/timelines (mix bars, dwell sections,
 * entity timelines) on escalation events. Same summary-surface rationale and
 * tier as the station metrics: lifecycle moments are the only things that
 * move an interval, so the event is the complete refresh signal.
 */
export function useEscalationAnalyticsEvents(): void {
  const invalidate = useThrottledInvalidation('SUMMARY');

  useEventSubscription(escalationPattern({}), () => {
    invalidate([['escAggregate'], ['escTimeline']]);
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
  const invalidate = useThrottledInvalidation('LIST');
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
  const invalidate = useThrottledInvalidation('DETAIL');

  useEventSubscription(
    escalationId
      ? escalationPattern({ id: escalationId })
      : escalationPattern({ id: '__none__' }),
    (event) => {
      if (!escalationId || event.escalationId !== escalationId) return;
      // Only THIS record's key: the list and stats surfaces carry their own
      // subscriptions, so the detail view never re-invalidates them.
      invalidate([['escalations', escalationId]]);
    },
  );
}

/**
 * Invalidate agent queries on agent lifecycle events.
 */
export function useAgentEvents(): void {
  const invalidate = useThrottledInvalidation('LIST');

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.agent.>`, () => {
    invalidate([['agents']]);
  });
}

/**
 * Invalidate knowledge queries on knowledge events.
 */
export function useKnowledgeEvents(): void {
  const invalidate = useThrottledInvalidation('LIST');

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.knowledge.>`, () => {
    invalidate([['knowledge']]);
  });
}

/**
 * Invalidate process list (ProcessesListPage) on task/workflow events.
 */
export function useProcessListEvents(): void {
  const invalidate = useThrottledInvalidation('LIST');

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.task.>`, () => {
    invalidate([['processes']]);
  });

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.workflow.>`, () => {
    invalidate([['processes']]);
  });
}
