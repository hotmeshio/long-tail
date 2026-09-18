import type { InvocableWorkflow } from '../../api/types';
import { WorkflowIcon } from '../common/display/WorkflowIcon';
import { EventsOffNotice } from '../../pages/workflows/start/InvokeFooter';
import { RunOutcomeLabel, RunOutline, RUN_OUTCOMES, useRunOutcome } from '../../pages/workflows/start/StartedRunNotice';

/**
 * What a dialog shows once its form is submitted: one state at a time. While
 * the run works, its icon and a pulse; once it completes, the returned data
 * as an outline with Done; if it fails, the reason with a way back to the
 * form holding what was typed. Closing while the run works leaves it running.
 */
export function RunReceipt({
  workflow,
  workflowId,
  onDone,
  onRetry,
}: {
  workflow: InvocableWorkflow;
  workflowId: string;
  onDone: () => void;
  onRetry: () => void;
}) {
  const run = useRunOutcome(workflowId);
  const failed = run.outcome === RUN_OUTCOMES.FAILED;
  const running = run.outcome === RUN_OUTCOMES.RUNNING;
  const failure = failed && typeof run.payload?.error === 'string' ? run.payload.error : null;

  return (
    <div className="flex flex-col gap-4" data-testid="run-receipt" data-outcome={run.outcome}>
      <div className="flex items-center gap-3">
        <WorkflowIcon icon={workflow.icon} tier={workflow.tier} className="w-6 h-6 shrink-0 text-accent" />
        <RunOutcomeLabel outcome={run.outcome} className="text-sm" />
      </div>
      {running && <EventsOffNotice />}
      {failure && <p className="text-xs text-status-error" role="alert">{failure}</p>}
      {!running && <RunOutline payload={failure ? undefined : run.payload} />}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-border/40">
        {failed && (
          <button type="button" onClick={onRetry} className="btn-secondary text-xs" data-testid="run-retry">
            Try again
          </button>
        )}
        <button type="button" onClick={onDone} className="btn-primary text-xs px-6" data-testid="run-done">
          {running || failed ? 'Close' : 'Done'}
        </button>
      </div>
    </div>
  );
}
