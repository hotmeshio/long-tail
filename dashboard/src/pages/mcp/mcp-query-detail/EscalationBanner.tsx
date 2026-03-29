import { Link, useNavigate } from 'react-router-dom';

interface EscalationBannerProps {
  escalation: any | undefined;
  isRoundsExhausted: boolean;
  diagnosis: string | undefined;
  onRetryTriage?: () => void;
  isRetrying?: boolean;
  /** The successful re-run workflow ID (discovered from triage result) */
  rerunWorkflowId?: string;
}

export function EscalationBanner({ escalation, isRoundsExhausted, diagnosis, onRetryTriage, isRetrying, rerunWorkflowId }: EscalationBannerProps) {
  const navigate = useNavigate();

  if (!escalation && !isRoundsExhausted) return null;

  const isPending = escalation?.status === 'pending';
  const isResolved = escalation?.status === 'resolved';

  // Extract triage metadata from resolver_payload
  const resolverPayload = (() => {
    if (!escalation?.resolver_payload) return null;
    try {
      return typeof escalation.resolver_payload === 'string'
        ? JSON.parse(escalation.resolver_payload)
        : escalation.resolver_payload;
    } catch { return null; }
  })();
  const wasTriaged = resolverPayload?._lt?.triaged === true;

  // Extract original failure context from escalation_payload
  const escalationPayload = (() => {
    if (!escalation?.escalation_payload) return null;
    try {
      return typeof escalation.escalation_payload === 'string'
        ? JSON.parse(escalation.escalation_payload)
        : escalation.escalation_payload;
    } catch { return null; }
  })();
  const originalDiagnosis = escalationPayload?.diagnosis as string | undefined;

  // ── Resolved by triage: outcome-focused ────────────────────────
  if (isResolved && wasTriaged) {
    return (
      <div className="rounded-md mb-4 border border-status-success/30 bg-surface-raised overflow-hidden">
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-start gap-3">
            <svg className="w-4 h-4 mt-0.5 shrink-0 text-status-success" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.36 4.65a.5.5 0 00-.72 0L7 9.29 5.36 7.65a.5.5 0 10-.72.7l2 2a.5.5 0 00.72 0l4-4a.5.5 0 000-.7z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-status-success">
                {rerunWorkflowId
                  ? 'This query succeeded after AI triage'
                  : 'AI triage resolved this query'}
              </p>
              <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
                {rerunWorkflowId
                  ? 'The original run hit a wall, but AI triage diagnosed the issue and re-ran the query successfully. The successful run is ready to compile into a deterministic workflow.'
                  : 'The original run hit a wall. AI triage diagnosed the issue and resolved it.'}
              </p>
            </div>
          </div>
        </div>

        {originalDiagnosis && (
          <div className="px-4 py-2 mx-4 mb-2 rounded bg-surface-sunken">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">What went wrong</p>
            <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{originalDiagnosis}</p>
          </div>
        )}

        {/* Clear outcomes */}
        <div className="px-4 py-3 border-t border-surface-border bg-surface-sunken/50">
          <div className="flex items-center gap-3">
            {rerunWorkflowId && (
              <button
                onClick={() => navigate(`/mcp/queries/${rerunWorkflowId}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-text-inverse rounded-md hover:bg-accent/90 transition-colors"
              >
                Continue to successful run
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M4.5 2l4 4-4 4" />
                </svg>
              </button>
            )}
            <button
              onClick={() => navigate('/mcp/queries')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary border border-surface-border rounded-md hover:bg-surface-sunken transition-colors"
            >
              Start fresh
            </button>
            <Link
              to={`/escalations/detail/${escalation.id}`}
              className="text-[10px] text-text-tertiary hover:text-accent hover:underline ml-auto"
            >
              Details
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Resolved (non-triage) ──────────────────────────────────────
  if (isResolved) {
    return (
      <div className="rounded-md px-4 py-3 mb-4 border bg-surface-raised border-status-success/30">
        <div className="flex items-start gap-3">
          <svg className="w-4 h-4 mt-0.5 shrink-0 text-status-success" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.36 4.65a.5.5 0 00-.72 0L7 9.29 5.36 7.65a.5.5 0 10-.72.7l2 2a.5.5 0 00.72 0l4-4a.5.5 0 000-.7z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-status-success">Escalation resolved</p>
            <p className="text-xs text-text-tertiary mt-1">
              This escalation was resolved manually. You can continue to compile.
            </p>
            <div className="flex items-center gap-3 mt-2">
              {escalation && (
                <Link to={`/escalations/detail/${escalation.id}`} className="text-[10px] text-accent hover:underline">
                  View escalation
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Pending / rounds exhausted ─────────────────────────────────
  return (
    <div className="rounded-md px-4 py-3 mb-4 border bg-surface-raised border-status-warning/30">
      <div className="flex items-start gap-3">
        <svg className="w-4 h-4 mt-0.5 shrink-0 text-status-warning" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 3a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 008 4zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-status-warning">
            {isRoundsExhausted
              ? 'This query exceeded the maximum tool rounds'
              : 'This query has a pending escalation'}
          </p>
          {diagnosis && (
            <p className="text-xs text-text-secondary mt-1 line-clamp-2">{diagnosis}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {isPending && onRetryTriage && (
              <button
                onClick={onRetryTriage}
                disabled={isRetrying}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-text-inverse rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 0.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zm2 6l-3 1.75v-3.5l3 1.75z" /></svg>
                {isRetrying ? 'Sending...' : 'Retry with AI Triage'}
              </button>
            )}
            {escalation && (
              <Link to={`/escalations/detail/${escalation.id}`} className="text-[10px] text-accent hover:underline">
                View escalation
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
