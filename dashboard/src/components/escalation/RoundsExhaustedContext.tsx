import { useState } from 'react';
import { Link } from 'react-router-dom';

import { JsonViewer } from '../common/data/JsonViewer';
import { SimpleMarkdown } from '../common/display/SimpleMarkdown';

interface RoundsExhaustedContextProps {
  payload: Record<string, unknown>;
  isTerminal?: boolean;
  resolverPayload?: Record<string, unknown> | null;
  onRetryTriage?: () => void;
  isRetrying?: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">{children}</p>
  );
}

export function RoundsExhaustedContext({ payload, isTerminal, resolverPayload, onRetryTriage, isRetrying }: RoundsExhaustedContextProps) {
  const title = payload.title as string | undefined;
  const summary = payload.summary as string | undefined;
  const diagnosis = payload.diagnosis as string | undefined;
  const toolCalls = payload.tool_calls_made as number | undefined;
  const result = payload.result as Record<string, unknown> | null | undefined;

  // Detect triage resolution
  const ltMeta = resolverPayload?._lt as Record<string, unknown> | undefined;
  const wasTriaged = ltMeta?.triaged === true;
  const triageWorkflowId = ltMeta?.triageWorkflowId as string | undefined;
  const isResolvedByTriage = isTerminal && wasTriaged;

  const [showResult, setShowResult] = useState(false);

  // Resolved by triage — show success state
  if (isResolvedByTriage) {
    return (
      <div className="rounded-md border border-status-success/30 bg-surface-raised">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-status-success shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.36 4.65a.5.5 0 00-.72 0L7 9.29 5.36 7.65a.5.5 0 10-.72.7l2 2a.5.5 0 00.72 0l4-4a.5.5 0 000-.7z" />
            </svg>
            <span className="text-xs font-medium text-status-success">Resolved by AI Triage</span>
          </div>
          {typeof toolCalls === 'number' && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-success/10 text-status-success">
              {toolCalls} tool calls used
            </span>
          )}
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4">
          {title && (
            <p className="text-sm font-medium text-text-primary">{title}</p>
          )}

          {diagnosis && (
            <div>
              <SectionLabel>Triage diagnosis</SectionLabel>
              <div className="text-xs text-text-primary leading-relaxed">
                <SimpleMarkdown content={diagnosis} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            {triageWorkflowId && (
              <Link
                to={`/workflows/executions/${triageWorkflowId}`}
                className="text-[10px] text-accent hover:underline"
              >
                View triage execution
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default: warning state
  return (
    <div className="rounded-md border border-status-warning/30 bg-surface-raised">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-status-warning shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 3a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 008 4zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z" />
          </svg>
          <span className="text-xs font-medium text-status-warning">Tool Rounds Exhausted</span>
        </div>
        {typeof toolCalls === 'number' && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-warning/10 text-status-warning">
            {toolCalls} tool calls used
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-4">
        {title && (
          <p className="text-sm font-medium text-text-primary">{title}</p>
        )}

        {summary && (
          <div>
            <SectionLabel>What happened</SectionLabel>
            <div className="text-xs text-text-secondary leading-relaxed">
              <SimpleMarkdown content={summary} />
            </div>
          </div>
        )}

        {diagnosis && (
          <div>
            <SectionLabel>What went wrong</SectionLabel>
            <div className="text-xs text-text-primary leading-relaxed">
              <SimpleMarkdown content={diagnosis} />
            </div>
          </div>
        )}

        {result != null && (
          <div>
            <button
              onClick={() => setShowResult(!showResult)}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <svg className={`w-3 h-3 transition-transform ${showResult ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="currentColor">
                <path d="M4.5 2l4 4-4 4" />
              </svg>
              Partial results
            </button>
            {showResult && (
              <div className="mt-2">
                <JsonViewer data={result} defaultMode="tree" />
              </div>
            )}
          </div>
        )}

        {onRetryTriage && !isTerminal && (
          <div className="pt-2">
            <button
              onClick={onRetryTriage}
              disabled={isRetrying}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-accent text-text-inverse rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 1a6 6 0 100 12A6 6 0 007 1zm2.5 6.5l-3.5 2V5.5l3.5 2z" />
              </svg>
              {isRetrying ? 'Sending to triage...' : 'Retry with AI Triage'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
