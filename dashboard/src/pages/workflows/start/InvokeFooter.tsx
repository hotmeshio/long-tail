import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';

/**
 * The submit footer every invoke form shares: sticky to the viewport bottom,
 * one line for the outcome, the Start button. A started run links to its
 * execution when the caller may open one; issues open the Issues view.
 */
export function InvokeFooter({
  onSubmit,
  pending,
  error,
  issueCount = 0,
  onShowIssues,
  startedId,
  executionPath,
}: {
  onSubmit: () => void;
  pending: boolean;
  error: string | null;
  issueCount?: number;
  onShowIssues?: () => void;
  startedId: string | null;
  executionPath: string | null;
}) {
  return (
    <div className="sticky bottom-0 z-10 bg-surface border-t border-surface-border/40 pt-3 pb-16 -mb-16 space-y-2">
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
      {startedId && (
        <p className="flex items-center gap-1.5 text-xs" role="status">
          <span className="text-status-success">Workflow started</span>
          <span className="text-text-quaternary">·</span>
          <span className="font-mono text-text-secondary truncate">{startedId}</span>
          {executionPath && (
            <>
              <span className="text-text-quaternary">·</span>
              <Link to={executionPath} className="text-accent hover:underline shrink-0">View workflow →</Link>
            </>
          )}
        </p>
      )}
      <button type="button" onClick={onSubmit} disabled={pending} className="btn-primary w-full" data-testid="invoke-start">
        {pending ? 'Starting…' : 'Start Workflow'}
      </button>
    </div>
  );
}
