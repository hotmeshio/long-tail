import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { StateBand } from './StateBands';
import type { EntityRow } from './entity-pivot';
import { formatDurationCompact } from '../../lib/format';

// One page of the entity table — overflow-driven paging, no total counts.
export const ENTITY_PAGE_SIZE = 50;

// The find input debounces into the URL-backed find term.
const FIND_DEBOUNCE_MS = 300;

/**
 * The per-entity tier: a find input (case-insensitive prefix on the entity
 * key), one dwell-ranked page of entity rows, and a Prev/Next pager. Row
 * click deep-links the entity (?entity=) which opens its timeline panel.
 */
export function EntityTable({
  entityKey,
  rows,
  colors,
  stateLabel,
  find,
  onFindChange,
  page,
  onPageChange,
  overflow,
  onEntityOpen,
}: {
  entityKey: string;
  rows: EntityRow[];
  colors: Map<string, string>;
  stateLabel: (state: string | undefined) => string;
  find: string | null;
  onFindChange: (term: string | null) => void;
  page: number;
  onPageChange: (page: number) => void;
  overflow: boolean;
  onEntityOpen: (value: string) => void;
}) {
  const [input, setInput] = useState(find ?? '');
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(debounce.current), []);
  // External term change (back/forward, lens reset) resyncs the input.
  useEffect(() => {
    setInput(find ?? '');
  }, [find]);

  const handleInput = (value: string) => {
    setInput(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const term = value.trim();
      onFindChange(term ? term : null);
    }, FIND_DEBOUNCE_MS);
  };

  return (
    <div className="max-w-3xl">
      <input
        type="text"
        value={input}
        onChange={(e) => handleInput(e.target.value)}
        placeholder={`Find by ${entityKey}…`}
        aria-label={`Find by ${entityKey}`}
        className="w-64 bg-transparent border-b border-surface-border/60 focus:border-accent focus:outline-none text-xs font-mono text-text-primary placeholder:text-text-quaternary pb-0.5 mb-3 transition-colors"
      />

      {rows.length === 0 ? (
        <p className="text-2xs text-text-quaternary">
          {find ? `No ${entityKey} starts with “${find}” in this window.` : 'No entities tracked in this window.'}
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((row) => (
            <div
              key={row.value}
              role="button"
              tabIndex={0}
              onClick={() => onEntityOpen(row.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onEntityOpen(row.value);
              }}
              className="flex items-center gap-3 text-2xs cursor-pointer group"
            >
              <span
                className="font-mono text-text-secondary group-hover:text-accent transition-colors truncate w-44 shrink-0"
                title={row.value}
              >
                {row.value}
              </span>
              <span className="flex items-center gap-1.5 w-32 shrink-0">
                {row.nowState && (
                  <>
                    <span className="w-2 h-2 rounded-full dot-ring shrink-0" style={{ backgroundColor: colors.get(row.nowState) }} />
                    <span className="font-mono text-text-tertiary truncate">{stateLabel(row.nowState)}</span>
                  </>
                )}
              </span>
              <StateBand groups={row.groups} colors={colors} height="h-1.5" className="flex-1" />
              <span className="font-mono tabular-nums text-text-secondary w-16 text-right shrink-0">
                {formatDurationCompact(row.total * 1000)}
              </span>
              <button
                className="icon-link shrink-0"
                title="Open timeline"
                onClick={(e) => {
                  e.stopPropagation();
                  onEntityOpen(row.value);
                }}
              >
                <History className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {(rows.length > 0 || page > 0) && (
        <div className="flex items-center gap-3 pt-2 text-2xs">
          <button
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
            className="text-text-tertiary hover:text-accent transition-colors disabled:opacity-40 disabled:hover:text-text-tertiary"
          >
            Prev
          </button>
          <span className="font-mono tabular-nums text-text-quaternary">page {page + 1}</span>
          <button
            disabled={!overflow}
            onClick={() => onPageChange(page + 1)}
            className="text-text-tertiary hover:text-accent transition-colors disabled:opacity-40 disabled:hover:text-text-tertiary"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
