import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventSubscriptions } from '../../../hooks/useEventContext';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import type { NatsLTEvent } from '../../../lib/nats/types';

export const RUN_OUTCOMES = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[keyof typeof RUN_OUTCOMES];

/** The dashboard subject for one run's lifecycle events. */
export function workflowEventPattern(workflowId: string, action: 'completed' | 'failed'): string {
  return `lt.events.system.workflow.${workflowId}.${action}`;
}

/**
 * Follows one run: subscribes to its completed and failed subjects the moment
 * it starts and holds the outcome and the returned payload. With no id there
 * is nothing to follow, so nothing is subscribed; a subject with an empty
 * token is a protocol error on NATS.
 */
export function useRunOutcome(workflowId: string): { outcome: RunOutcome; payload: Record<string, unknown> | undefined } {
  const [outcome, setOutcome] = useState<RunOutcome>(RUN_OUTCOMES.RUNNING);
  const [payload, setPayload] = useState<Record<string, unknown> | undefined>(undefined);

  useEffect(() => {
    setOutcome(RUN_OUTCOMES.RUNNING);
    setPayload(undefined);
  }, [workflowId]);

  useEventSubscriptions(
    workflowId ? [workflowEventPattern(workflowId, 'completed'), workflowEventPattern(workflowId, 'failed')] : [],
    (event: NatsLTEvent) => {
      if (event.workflowId !== workflowId) return;
      setOutcome(event.type.endsWith('.failed') ? RUN_OUTCOMES.FAILED : RUN_OUTCOMES.COMPLETED);
      setPayload(event.data);
    },
  );

  return { outcome, payload };
}

/** The one-line status: outcome, id, and the execution link for callers who may open it. */
export function RunStatusLine({ workflowId, outcome, executionPath }: { workflowId: string; outcome: RunOutcome; executionPath: string | null }) {
  const tone = outcome === RUN_OUTCOMES.FAILED ? 'text-status-error' : 'text-status-success';
  const label = outcome === RUN_OUTCOMES.RUNNING ? 'Started'
    : outcome === RUN_OUTCOMES.COMPLETED ? 'Completed' : 'Failed';
  return (
    <p className="flex items-center gap-1.5 text-xs min-w-0" role="status" data-testid="started-run">
      <span className={tone}>{label}</span>
      {outcome === RUN_OUTCOMES.RUNNING && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden />}
      <span className="text-text-quaternary">·</span>
      <span className="font-mono text-text-secondary truncate">{workflowId}</span>
      {executionPath && (
        <>
          <span className="text-text-quaternary">·</span>
          <Link to={executionPath} className="text-accent hover:underline shrink-0">View workflow →</Link>
        </>
      )}
    </p>
  );
}

/** The returned payload, full width in a fixed-height zone that scrolls on its own. */
export function RunResult({ payload }: { payload: Record<string, unknown> | undefined }) {
  if (!payload || Object.keys(payload).length === 0) return null;
  return (
    <div
      className="mt-3 h-48 overflow-y-auto rounded-md border border-surface-border bg-surface-raised px-3 py-2"
      data-testid="started-run-result"
    >
      <JsonViewer data={payload} label="Result" />
    </div>
  );
}
