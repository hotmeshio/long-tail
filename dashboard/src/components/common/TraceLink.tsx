interface TraceLinkProps {
  traceId?: string | null;
  spanId?: string | null;
  traceUrl?: string | null;
  className?: string;
}

export function TraceLink({ traceId, spanId, traceUrl, className = '' }: TraceLinkProps) {
  if (!traceId) return null;

  const href = traceUrl
    ? traceUrl.replace('{traceId}', traceId) + (spanId ? `&span=${spanId}` : '')
    : undefined;

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-[10px] font-mono text-accent hover:underline truncate ${className}`}
        title={`Trace: ${traceId}`}
      >
        trace &rarr;
      </a>
    );
  }

  return (
    <span
      className={`text-[10px] font-mono text-text-tertiary truncate cursor-default ${className}`}
      title={`Trace: ${traceId}${spanId ? `\nSpan: ${spanId}` : ''}`}
    >
      {traceId.slice(0, 12)}&hellip;
    </span>
  );
}
