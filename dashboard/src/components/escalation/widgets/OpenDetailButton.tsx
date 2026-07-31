import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

/**
 * The one affordance for opening an embedded row's detail page — a clear
 * icon-in-a-button, not a bare glyph, so the gesture reads as "open this". The
 * tooltip stays generic ("View details") rather than naming the record kind, so
 * the same control fits any embed. Non-focusable: the row/card click and the
 * canned actions carry the keyboard path; this is a pointer shortcut.
 */
export function OpenDetailButton({ to, className = '' }: { to: string; className?: string }) {
  return (
    <Link
      to={to}
      title="View details"
      tabIndex={-1}
      className={`inline-flex items-center justify-center w-6 h-6 shrink-0 rounded border border-surface-border text-accent/70 hover:text-accent hover:border-accent/60 hover:bg-accent/5 transition-colors ${className}`}
    >
      <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2} />
      <span className="sr-only">View details</span>
    </Link>
  );
}
