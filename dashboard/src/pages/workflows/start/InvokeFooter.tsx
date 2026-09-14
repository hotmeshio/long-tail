import { AlertCircle, RadioTower } from 'lucide-react';
import { useEventStatus } from '../../../hooks/useEventContext';
import { RunResult, RunStatusLine, RUN_OUTCOMES, useRunOutcome } from './StartedRunNotice';

/**
 * The submit row every invoke form shares, stuck to the bottom of the shell
 * scroll. One line: status on the left, Submit on the right. Once a run
 * starts the button gives way to "Submit again" until the person chooses it,
 * and the returned result fills the width beneath in a zone that scrolls on
 * its own. A live events warning appears when the result could not arrive.
 */
export function InvokeFooter({
  onSubmit,
  onSubmitAgain,
  pending,
  error,
  issueCount = 0,
  onShowIssues,
  startedId,
  executionPath,
}: {
  onSubmit: () => void;
  /** Clears the last run so the button arms again. */
  onSubmitAgain: () => void;
  pending: boolean;
  error: string | null;
  issueCount?: number;
  onShowIssues?: () => void;
  startedId: string | null;
  executionPath: string | null;
}) {
  const { connected } = useEventStatus();
  const run = useRunOutcome(startedId ?? '');
  const submitted = startedId !== null;

  return (
    <div className="sticky bottom-0 z-10 bg-surface border-t border-surface-border/40 pt-3 pb-16 -mb-16">
      <div className="flex items-center justify-between gap-6 min-h-9">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {!connected && (
            <p className="flex items-center gap-1.5 text-2xs text-status-warning" data-testid="events-warning">
              <RadioTower className="w-3 h-3 shrink-0" strokeWidth={1.5} />
              Live events are off, so the result will not appear here.
              <button type="button" onClick={() => window.location.reload()} className="text-accent hover:underline">
                Reconnect events
              </button>
            </p>
          )}
          {issueCount > 0 && onShowIssues ? (
            <button
              type="button"
              onClick={onShowIssues}
              className="flex items-center gap-1.5 text-xs text-status-error hover:underline"
              data-testid="invoke-issues"
            >
              <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
              {issueCount} {issueCount === 1 ? 'issue' : 'issues'} to resolve
            </button>
          ) : error ? (
            <p className="text-xs text-status-error" role="alert">{error}</p>
          ) : null}
          {startedId && <RunStatusLine workflowId={startedId} outcome={run.outcome} executionPath={executionPath} />}
        </div>

        <div className="shrink-0">
          {submitted ? (
            <button
              type="button"
              onClick={onSubmitAgain}
              className="text-xs text-accent hover:underline"
              data-testid="invoke-again"
            >
              Submit again
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending}
              className="btn-primary px-8 py-2"
              data-testid="invoke-start"
            >
              {pending ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      </div>

      {submitted && run.outcome !== RUN_OUTCOMES.RUNNING && <RunResult payload={run.payload} />}
    </div>
  );
}
