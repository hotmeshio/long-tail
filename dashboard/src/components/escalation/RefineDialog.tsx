import { useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../common/modal/Modal';
import { metadataFacetsUrl } from '../../lib/facet-url';

/** One refinable fact from a row: a metadata key with its authored label and value. */
export interface RefinePair {
  key: string;
  label: string;
  value: unknown;
}

/**
 * The row-level refine gesture for authored lists (facet-table rows, board
 * cards): the row's metadata-bound facts as full-width touch rows, each a
 * toggle. Pick one or several (multi-select ANDs the facets) and drill —
 * filter this role's queue, search every role, or merge into the live filter
 * set. One dialog replaces per-cell icon pairs, so table cells spend their
 * width on data and the affordance stays tappable on the iPad floor.
 */
export function RefineDialog({ open, onClose, role, pairs, onNavigate, onAddFacet }: {
  open: boolean;
  onClose: () => void;
  role: string;
  pairs: RefinePair[];
  /** Receives the facet deep-link. Hosts navigate (or open a panel). */
  onNavigate: (url: string) => void;
  /** When provided, "Add to filters" merges the selection into the live set. */
  onAddFacet?: (key: string, value: unknown) => void;
}) {
  // A single fact arrives selected — the one-glance, two-tap path.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSelected(new Set(pairs.length === 1 ? [pairs[0].key] : []));
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const chosen = pairs.filter((p) => selected.has(p.key));
  const facets = Object.fromEntries(chosen.map((p) => [p.key, p.value]));
  const none = chosen.length === 0;

  const go = (url: string) => {
    onClose();
    onNavigate(url);
  };

  return (
    <Modal open={open} onClose={onClose} title="Refine">
      <div className="space-y-4">
        <p className="text-2xs text-text-tertiary">
          Pick the facts to match — several combine into one narrower query.
        </p>

        <div className="divide-y divide-surface-border/40 -mx-1">
          {pairs.map((p) => {
            const on = selected.has(p.key);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => toggle(p.key)}
                aria-pressed={on}
                className="w-full flex items-center gap-3 px-1 py-2.5 text-left group min-w-0"
                data-testid="refine-pair"
              >
                <span
                  className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${
                    on ? 'bg-accent border-accent' : 'border-surface-border group-hover:border-accent/50'
                  }`}
                  aria-hidden
                >
                  {on && <Check className="w-3 h-3 text-text-inverse" strokeWidth={3} />}
                </span>
                <span className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary w-28 shrink-0 truncate" title={p.key}>
                  {p.label}
                </span>
                <span className="text-xs text-text-primary truncate flex-1 min-w-0" title={String(p.value)}>
                  {String(p.value)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
          {onAddFacet && (
            <button
              onClick={() => {
                chosen.forEach((p) => onAddFacet(p.key, p.value));
                onClose();
              }}
              disabled={none}
              className="text-xs text-text-secondary hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed mr-auto"
              data-testid="refine-add-filters"
            >
              Add to filters
            </button>
          )}
          <button
            onClick={() => go(metadataFacetsUrl(facets))}
            disabled={none}
            className="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="refine-search-all"
          >
            Search everywhere
          </button>
          <button
            onClick={() => go(metadataFacetsUrl(facets, role))}
            disabled={none}
            className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="refine-filter-role"
          >
            Filter {role}
          </button>
        </div>
      </div>
    </Modal>
  );
}
