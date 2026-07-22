import { X } from 'lucide-react';
import { FacetedFilterPanel } from './FacetedFilterPanel';
import type { FacetFilters } from '../../api/escalations';

/**
 * Faceted metadata query — the body of the shell's global right panel on the
 * escalations master list. Precise metadata facets plus exact correlation-id
 * lookup, composed into one SQL query.
 */
export function FacetQueryPanel({
  value,
  onChange,
  facetKeys,
  search,
  onSearchChange,
  activeFacetCount,
  onClear,
  onClose,
}: {
  value: FacetFilters;
  onChange: (v: FacetFilters) => void;
  facetKeys: string[];
  search: string;
  onSearchChange: (v: string) => void;
  activeFacetCount: number;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-surface-raised border-b border-surface-border/50">
        <span className="text-xs font-semibold text-text-primary">Faceted query</span>
        <div className="flex items-center gap-2">
          {activeFacetCount > 0 && (
            <button
              onClick={onClear}
              className="text-2xs text-text-tertiary hover:text-text-primary transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="px-4 py-2">
        <p className="mb-2 text-2xs leading-snug text-text-tertiary">
          Precise metadata facets plus exact correlation-id lookup — they compose in one
          SQL query. Facet keys are the ones that actually exist in your visible escalations.
          Set status to <span className="font-medium">All</span> to find an order across every
          status; the whole query is shareable via the URL.
        </p>
        <FacetedFilterPanel
          value={value}
          onChange={onChange}
          facetKeys={facetKeys}
          search={search}
          onSearchChange={onSearchChange}
        />
      </div>
    </div>
  );
}
