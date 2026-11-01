import { Pause, Play, Eraser, X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { WIRE_KINDS, type WireDirection, type WireEvent, type WireKind } from '../../api/machines';
import type { WireTapeFilters } from '../../hooks/useWireTape';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { WireRow } from './WireRow';

export interface WireTapeProps {
  events: WireEvent[];
  total: number;
  paused: boolean;
  heldCount: number;
  filters: WireTapeFilters;
  machines: string[];
  channels: string[];
  setFilter: (patch: Partial<WireTapeFilters>) => void;
  togglePause: () => void;
  clear: () => void;
  onOpen: (event: WireEvent) => void;
  /** Extra header controls after Clear: full screen, watch. */
  controls?: ReactNode;
  /** Sizes the scrolling list; the section decides how much room it has. */
  listClassName?: string;
  listRef?: RefObject<HTMLUListElement | null>;
}

const DEFAULT_LIST_CLASS = 'flex-1 min-h-0';

const DIRECTIONS: { value: WireDirection; label: string }[] = [
  { value: 'in', label: 'in' },
  { value: 'out', label: 'out' },
];

function activeFilterCount(filters: WireTapeFilters): number {
  return [filters.machine, filters.channel, filters.direction, filters.kind].filter(Boolean).length
    + (filters.violationsOnly ? 1 : 0);
}

/**
 * The live list of wire events, newest first, with its filter band and the
 * pause that holds new arrivals aside while you read. The band folds its
 * controls behind one Filters button when the container is narrow; the rows
 * fold from columns into console cards below the table threshold.
 */
export function WireTape(props: WireTapeProps) {
  const { events, total, paused, heldCount, filters, machines, channels, setFilter, togglePause, clear, onOpen, controls, listClassName, listRef } = props;
  return (
    <div className="flex flex-col min-h-0 flex-1 @container/tape">
      <FilterBar
        embedded
        activeFilterCount={activeFilterCount(filters)}
        actions={
          <>
            <span className="text-2xs text-text-quaternary tabular-nums whitespace-nowrap">
              {events.length} shown · {total} on tape
            </span>
            <button
              type="button"
              onClick={togglePause}
              aria-pressed={paused}
              className="inline-flex items-center gap-1 text-2xs icon-link whitespace-nowrap"
              title={paused ? 'Resume the tape' : 'Pause the tape'}
            >
              {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {paused ? `Resume${heldCount ? ` · ${heldCount} held` : ''}` : 'Pause'}
            </button>
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-2xs icon-link" title="Clear the tape">
              <Eraser className="w-3 h-3" />
              Clear
            </button>
            {controls}
          </>
        }
      >
        <FilterSelect
          label="Machine"
          value={filters.machine ?? ''}
          onChange={(v) => setFilter({ machine: v || null })}
          options={machines.map((m) => ({ value: m, label: m }))}
          placeholder="every machine"
        />
        <FilterSelect
          label="Channel"
          value={filters.channel ?? ''}
          onChange={(v) => setFilter({ channel: v || null })}
          options={channels.map((c) => ({ value: c, label: c }))}
          placeholder="every channel"
        />
        <FilterSelect
          label="Direction"
          value={filters.direction ?? ''}
          onChange={(v) => setFilter({ direction: (v || null) as WireDirection | null })}
          options={DIRECTIONS}
          placeholder="both"
        />
        <FilterSelect
          label="Kind"
          value={filters.kind ?? ''}
          onChange={(v) => setFilter({ kind: (v || null) as WireKind | null })}
          options={WIRE_KINDS.map((k) => ({ value: k, label: k }))}
          placeholder="every kind"
        />
        <button
          type="button"
          aria-pressed={filters.violationsOnly}
          onClick={() => setFilter({ violationsOnly: !filters.violationsOnly })}
          className={`self-start px-2 py-1 text-2xs rounded border transition-colors whitespace-nowrap ${
            filters.violationsOnly
              ? 'border-status-warning text-status-warning'
              : 'border-surface-border text-text-secondary hover:text-text-primary'
          }`}
        >
          Violations only
        </button>
      </FilterBar>
      {filters.machine && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-2xs shrink-0">
          <span className="text-text-quaternary">Following</span>
          <button
            type="button"
            onClick={() => setFilter({ machine: null })}
            className="inline-flex items-center gap-1 rounded-full border border-surface-border px-2 py-0.5 font-mono text-text-primary hover:text-accent transition-colors"
            title="Show every machine"
          >
            {filters.machine}
            <X className="w-3 h-3" />
            <span className="font-sans text-text-tertiary">release</span>
          </button>
        </div>
      )}
      {events.length === 0 ? (
        <p className="text-2xs text-text-tertiary px-3 py-3">
          {total === 0 ? 'Waiting for traffic on the wire.' : 'Every event on the tape is filtered out.'}
        </p>
      ) : (
        <ul ref={listRef} className={`${listClassName ?? DEFAULT_LIST_CLASS} overflow-y-auto`} aria-label="Wire tape">
          {events.map((event) => (
            <WireRow key={`${event.at}-${event.id ?? ''}-${event.topic}-${event.direction}`} event={event} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}
