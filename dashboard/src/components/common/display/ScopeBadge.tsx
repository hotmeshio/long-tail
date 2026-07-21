import { Eye, Pencil } from 'lucide-react';
import type { LTReadScope, LTWriteScope } from '../../../api/types';

const SEE: Record<LTReadScope, string> = { self: 'Self', all: 'All' };
const ACT: Record<LTWriteScope, string> = { none: 'None', self: 'Self', all: 'All' };

/**
 * Renders a member's work-surface scope as two aligned facts rather than a
 * sentence: what they can **see** (Eye) and what they can **act on** (Pencil).
 * The value cells are fixed-width so `All` / `Self` / `None` line up in a column
 * across stacked rows.
 */
export function ScopeBadge({
  read,
  write,
  className = '',
}: {
  read: LTReadScope;
  write: LTWriteScope;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-2xs text-text-tertiary ${className}`}>
      <span className="inline-flex items-center gap-1" title="Can see">
        <Eye className="w-3 h-3 shrink-0 opacity-70" />
        <span className="w-7">{SEE[read]}</span>
      </span>
      <span className="inline-flex items-center gap-1" title="Can act on">
        <Pencil className="w-3 h-3 shrink-0 opacity-70" />
        <span className="w-7">{ACT[write]}</span>
      </span>
    </span>
  );
}
