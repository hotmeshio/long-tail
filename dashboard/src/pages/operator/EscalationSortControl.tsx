import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { FacetOrder } from '../../api/escalations';

const DEFAULT_FIELD = 'created_at';

/** Strip a leading "metadata." so a facet sort reads as its bare key. */
function sortLabel(field: string): string {
  return field.replace(/^metadata\./, '');
}

/**
 * The single sort control for every escalation view — table, timeline, and the
 * rich role list. Direction is a down/up radio (newest / oldest by default, or
 * desc / asc of a chosen field). The field is created_at by default and only
 * surfaces as a small removable label when a column or metadata sort was picked
 * in the faceted drawer — so the arrows always read clearly.
 *
 * State lives in `orderBy`, so it deep-links in the URL and drives the robust
 * faceted query on the server (the same mechanism that already works). The old
 * table-header sort is retired in favor of this.
 */
export function EscalationSortControl({ orderBy, onChange }: {
  orderBy?: FacetOrder[];
  onChange: (next: FacetOrder[] | undefined) => void;
}) {
  const spec = orderBy?.[0];
  const field = spec?.field ?? DEFAULT_FIELD;
  const direction = spec?.direction ?? 'desc';
  const isDefaultField = field === DEFAULT_FIELD;

  const set = (dir: 'asc' | 'desc') => onChange([{ ...(spec ?? {}), field, direction: dir }]);

  return (
    <div className="flex items-center gap-1.5">
      {!isDefaultField && (
        <span className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/8 px-2 py-0.5 text-2xs font-medium text-accent/90">
          <span className="text-text-quaternary">sort</span>
          <span className="font-mono max-w-[120px] truncate" title={field}>{sortLabel(field)}</span>
          <button
            onClick={() => onChange(undefined)}
            className="ml-0.5 -mr-0.5 flex items-center text-text-quaternary hover:text-status-error transition-colors"
            aria-label="Reset sort to created date"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      )}
      <div className="flex items-center rounded overflow-hidden border border-surface-border" role="radiogroup" aria-label="Sort direction">
        <button
          type="button"
          role="radio"
          aria-checked={direction === 'desc'}
          onClick={() => set('desc')}
          className={`px-1.5 py-1 transition-colors ${direction === 'desc' ? 'bg-accent text-text-inverse' : 'text-text-tertiary hover:bg-surface-hover'}`}
          title={isDefaultField ? 'Newest first' : `${sortLabel(field)} descending`}
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={direction === 'asc'}
          onClick={() => set('asc')}
          className={`px-1.5 py-1 border-l border-surface-border transition-colors ${direction === 'asc' ? 'bg-accent text-text-inverse' : 'text-text-tertiary hover:bg-surface-hover'}`}
          title={isDefaultField ? 'Oldest first' : `${sortLabel(field)} ascending`}
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
