import { useState } from 'react';

export function TraceLink({ traceId, href }: { traceId: string; href?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(traceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleNav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <span className="group/trace inline-flex items-center gap-1.5">
      <span className="text-[11px] text-accent">Trace Details</span>
      <button
        onClick={handleCopy}
        title="Copy trace ID"
        className="opacity-0 group-hover/trace:opacity-100 transition-opacity p-0.5"
      >
        <svg
          className={`w-3 h-3 transition-colors ${copied ? 'text-status-success' : 'text-text-tertiary hover:text-accent'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          {copied
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
          }
        </svg>
      </button>
      {href && (
        <button
          onClick={handleNav}
          title="Open trace"
          className="opacity-0 group-hover/trace:opacity-100 transition-opacity p-0.5"
        >
          <svg className="w-3 h-3 text-text-tertiary hover:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-4.5h6m0 0v6m0-6L10.5 15" />
          </svg>
        </button>
      )}
    </span>
  );
}
