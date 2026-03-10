import type { McpQueryResult } from '../../api/insight';

interface McpQueryResultCardProps {
  result: McpQueryResult;
}

export function McpQueryResultCard({ result }: McpQueryResultCardProps) {
  const hasResult = result.result !== undefined && result.result !== null;

  return (
    <div className="mt-10">
      {/* Title */}
      <h3 className="text-xl font-medium text-text-primary">
        {result.title || 'Done'}
      </h3>

      {/* Summary */}
      {result.summary && (
        <p className="text-sm text-text-secondary leading-relaxed mt-3 mb-10">
          {result.summary}
        </p>
      )}

      {/* Result data */}
      {hasResult && (
        <div className="mb-10">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Result
          </h4>
          <pre className="text-[11px] text-text-secondary bg-surface-sunken border border-surface-border rounded-md p-4 overflow-x-auto max-h-60 whitespace-pre-wrap">
            {typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center gap-4 mt-10 text-[10px] text-text-tertiary">
        <span>
          {result.tool_calls_made} tool call{result.tool_calls_made !== 1 ? 's' : ''}
        </span>
        <span>{(result.duration_ms / 1000).toFixed(1)}s</span>
        <span className="font-mono">{result.workflow_id}</span>
      </div>
    </div>
  );
}
