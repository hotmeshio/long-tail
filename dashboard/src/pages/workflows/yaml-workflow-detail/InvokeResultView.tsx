import { Link } from 'react-router-dom';
import { Collapsible } from '../../../components/common/Collapsible';
import { JsonViewer } from '../../../components/common/JsonViewer';
import { metadataLabels, formatMetadataValue } from './helpers';

export function InvokeResultView({ result, showMetadata, onToggleMetadata, traceUrl, namespace }: {
  result: Record<string, unknown>; showMetadata: boolean;
  onToggleMetadata: () => void; traceUrl?: string | null; namespace?: string;
}) {
  const raw = (result as any)?.result ?? result;
  const jobId = (result as any)?.job_id as string | undefined;
  const hasEnvelope = raw?.metadata && raw?.data;
  const displayData = hasEnvelope ? raw.data : raw;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Result</span>
        <div className="flex items-center gap-3">
          {jobId && (
            <Link
              to={`/mcp/runs/${encodeURIComponent(jobId)}?namespace=${encodeURIComponent(namespace || 'longtail')}`}
              className="text-[10px] text-accent hover:underline"
            >
              View Execution Details
            </Link>
          )}
          {hasEnvelope && (
            <button type="button" onClick={onToggleMetadata} className="text-[10px] text-accent hover:underline">
              {showMetadata ? 'Hide metadata' : 'Show metadata'}
            </button>
          )}
        </div>
      </div>
      <Collapsible open={showMetadata && !!hasEnvelope}>
        <div className="bg-surface-raised border border-surface-border rounded-md p-3 mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Metadata</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {hasEnvelope && Object.entries(raw.metadata as Record<string, unknown>)
              .sort((a, b) => {
                const order = Object.keys(metadataLabels);
                return (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]));
              })
              .map(([key, val]) => (
              <div key={key}>
                <p className="text-[10px] text-text-tertiary">{metadataLabels[key] ?? key}</p>
                {key === 'trc' && traceUrl && val ? (
                  <a href={traceUrl.replace('{traceId}', String(val))} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-mono text-accent hover:underline truncate block" title={String(val)}>
                    {String(val)}
                  </a>
                ) : (
                  <p className="text-xs font-mono text-text-primary truncate" title={String(val ?? '')}>
                    {formatMetadataValue(key, val)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </Collapsible>
      <JsonViewer data={displayData} label="Data" />
    </div>
  );
}
