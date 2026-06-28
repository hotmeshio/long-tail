import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ELLIPSIS_MAX = 20;

function centerEllipsis(s: string, max = ELLIPSIS_MAX): string {
  if (s.length <= max) return s;
  const side = Math.floor((max - 1) / 2);
  return `${s.slice(0, side)}…${s.slice(-side)}`;
}

interface CopyableIdProps {
  label?: string;
  value: string | null | undefined;
  href?: string;
  external?: boolean;
  /** Render only the value row (copy/navigate), without the built-in label. */
  bare?: boolean;
}

export function CopyableId({ label, value, href, external, bare }: CopyableIdProps) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  if (!value) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!href) return;
    if (external) {
      window.open(href, '_blank', 'noopener,noreferrer');
    } else {
      navigate(href);
    }
  };

  const valueButtons = (
    <>
      <button onClick={handleCopy} title="Copy" className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5">
        <svg className={`w-3 h-3 transition-colors ${copied ? 'text-status-success' : 'text-text-tertiary hover:text-text-primary'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {copied
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
          }
        </svg>
      </button>
      {href && (
        <button onClick={handleNavigate} title={`View ${label ?? 'link'}`} className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5">
          <svg className="w-3 h-3 text-text-tertiary hover:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>
      )}
    </>
  );

  if (bare) {
    return (
      <span className="flex items-center gap-1 group relative">
        <button onClick={handleCopy} title={value} className="font-mono text-text-primary group-hover:text-accent transition-colors">
          {centerEllipsis(value)}
        </button>
        {valueButtons}
      </span>
    );
  }

  return (
    <div className="text-left group relative">
      <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">{label}</span>
      <span className="flex items-center gap-1 mt-0.5">
        <button onClick={handleCopy} title={value} className="text-[12px] font-mono text-text-primary group-hover:text-accent transition-colors">
          {centerEllipsis(value)}
        </button>
        {valueButtons}
      </span>
    </div>
  );
}
