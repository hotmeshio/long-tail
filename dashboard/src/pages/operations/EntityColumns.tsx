import { useMemo } from 'react';
import { History, ArrowRight, Clock } from 'lucide-react';
import { StateBand } from './StateBands';
import { CenterEllipsis } from '../../components/common/display/CenterEllipsis';
import { useAggregateByFacets, type AnalyticsWindow } from '../../api/escalation-analytics';
import type { AggregateRow } from '../../api/escalation-analytics';
import type { EntityRow } from './entity-pivot';
import { entityValues, pivotEntities } from './entity-pivot';
import { formatDurationCompact } from '../../lib/format';

// Compare mode shows a bounded top-K per column — a scannable snapshot, not a
// paginated surface. Drilling into a value (focus) is where deep paging lives.
export const COMPARE_TOP_K = 15;

// One shared column template — dot · identifier · timeline · clock — applied to
// the header AND every row so they line up exactly, whatever the facet value's
// length (the identifier cell center-ellipsizes to stay in its track). Time
// values are demoted to the clock's hover title, never a column of their own.
const ROW_GRID = 'grid grid-cols-[0.6rem_7rem_minmax(2rem,1fr)_1rem] items-center gap-2.5';

// Focus / single-list paging: a standard set of sizes.
export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * One entity row: a filled dot in the current-state color (its label is the
 * hover title, not repeated as text), the id center-ellipsized so the trailing
 * digits stay readable, the dwell timeline that fills the cell, the tracked
 * total. The whole row deep-links the entity's timeline.
 */
export function EntityRowItem({
  row,
  colors,
  stateLabel,
  onOpen,
}: {
  row: EntityRow;
  colors: Map<string, string>;
  stateLabel: (state: string | undefined) => string;
  onOpen: (value: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(row.value); }}
      className={`${ROW_GRID} text-2xs cursor-pointer group py-0.5`}
    >
      <span
        className="w-2 h-2 rounded-full dot-ring justify-self-center"
        style={{ backgroundColor: row.nowState ? colors.get(row.nowState) : 'transparent' }}
        title={row.nowState ? stateLabel(row.nowState) : 'no current state'}
      />
      <CenterEllipsis
        text={row.value}
        className="font-mono text-text-secondary group-hover:text-accent transition-colors"
      />
      <StateBand groups={row.groups} colors={colors} height="h-1.5" className="min-w-[2rem]" />
      <button
        className="icon-link justify-self-center"
        title={`${formatDurationCompact(row.total * 1000)} tracked · open timeline`}
        onClick={(e) => { e.stopPropagation(); onOpen(row.value); }}
      >
        <History className="w-3 h-3" />
      </button>
    </div>
  );
}

/**
 * A presentational column: an optional header (a slice value's own timeline,
 * clickable to focus that value), the entity rows, and an optional "more"
 * affordance that drills into the value's full, paginated list.
 */
function EntityColumnView({
  sliced,
  header,
  rows,
  colors,
  stateLabel,
  onOpen,
  onTarget,
  hasMore,
  emptyText,
}: {
  sliced: boolean;
  header?: { value: string; groups: AggregateRow[]; total: number };
  rows: EntityRow[];
  colors: Map<string, string>;
  stateLabel: (state: string | undefined) => string;
  onOpen: (value: string) => void;
  onTarget?: (value: string) => void;
  hasMore?: boolean;
  emptyText?: string;
}) {
  return (
    <div className={sliced ? 'w-72 shrink-0' : 'flex-1 max-w-3xl'}>
      {header && (
        <button
          type="button"
          onClick={() => onTarget?.(header.value)}
          className={`${ROW_GRID} w-full text-left mb-2 group`}
        >
          {/* empty dot slot — keeps the header's identifier aligned with rows */}
          <span aria-hidden />
          <CenterEllipsis
            text={header.value}
            className="font-mono text-xs font-medium text-text-primary group-hover:text-accent transition-colors"
          />
          {/* thicker band — the value's whole state timeline */}
          <StateBand groups={header.groups} colors={colors} height="h-2.5" className="min-w-[2rem]" />
          <span
            className="icon-link justify-self-center"
            title={`${formatDurationCompact(header.total * 1000)} total in ${header.value} — the band shows the state split`}
          >
            <Clock className="w-3 h-3" />
          </span>
        </button>
      )}
      {rows.length === 0 ? (
        <p className="text-2xs text-text-quaternary">{emptyText ?? 'No entities on this page.'}</p>
      ) : (
        <div className="space-y-0.5">
          {rows.map((row) => (
            <EntityRowItem key={row.value} row={row} colors={colors} stateLabel={stateLabel} onOpen={onOpen} />
          ))}
        </div>
      )}
      {hasMore && header && onTarget && (
        <button
          type="button"
          onClick={() => onTarget(header.value)}
          className="mt-2 inline-flex items-center gap-1 text-2xs text-accent hover:text-accent-hover transition-colors"
        >
          More <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/**
 * One compare-mode column. Fetches the value's own top-K entities (dwell-ranked)
 * plus their state splits and current states — a bounded, self-contained pull,
 * cheap because a categorical facet has few values. Its header is the value's
 * whole timeline (passed from the slice aggregate); "More" drills into focus.
 */
export function SliceColumnLoader({
  entityKey,
  sliceKey,
  value,
  headerGroups,
  headerTotal,
  window,
  find,
  colors,
  stateLabel,
  onOpen,
  onTarget,
}: {
  entityKey: string;
  sliceKey: string;
  value: string;
  headerGroups: AggregateRow[];
  headerTotal: number;
  window: AnalyticsWindow;
  find: string | null;
  colors: Map<string, string>;
  stateLabel: (state: string | undefined) => string;
  onOpen: (value: string) => void;
  onTarget: (value: string) => void;
}) {
  // Scope by exact text match on the facet — the value came from the aggregate
  // as text, and `equals` round-trips it (a jsonb-containment anyOf would need
  // the native bool/number the text projection has already dropped).
  const scope = { entity: entityKey, equals: { [sliceKey]: value } };
  const rank = useAggregateByFacets({
    query: { ...scope, ...(find ? { prefix: { [entityKey]: find } } : {}) },
    groupBy: { facets: [entityKey] },
    measure: { kind: 'dwell', window },
    orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
    limit: COMPARE_TOP_K,
  });
  const pageValues = useMemo(
    () => entityValues(rank.data?.groups ?? [], entityKey),
    [rank.data, entityKey],
  );
  const anyOf = pageValues.map((v) => ({ [entityKey]: v }));
  const states = useAggregateByFacets(
    pageValues.length
      ? { query: { entity: entityKey, anyOf }, groupBy: { state: true, facets: [entityKey] }, measure: { kind: 'dwell', window }, limit: COMPARE_TOP_K * 4 }
      : null,
  );
  const now = useAggregateByFacets(
    pageValues.length
      ? { query: { entity: entityKey, anyOf }, groupBy: { state: true, facets: [entityKey] }, measure: { kind: 'membership' } }
      : null,
  );
  const rows = useMemo(
    () => pivotEntities(rank.data?.groups ?? [], states.data?.groups ?? [], now.data?.groups ?? [], entityKey),
    [rank.data, states.data, now.data, entityKey],
  );

  return (
    <EntityColumnView
      sliced
      header={{ value, groups: headerGroups, total: headerTotal }}
      rows={rows}
      colors={colors}
      stateLabel={stateLabel}
      onOpen={onOpen}
      onTarget={onTarget}
      hasMore={rank.data?.overflow ?? false}
    />
  );
}

/** A single wide column — the unsliced ranking or a focused value's paged list. */
export function SingleColumn({
  rows,
  colors,
  stateLabel,
  onOpen,
  emptyText,
}: {
  rows: EntityRow[];
  colors: Map<string, string>;
  stateLabel: (state: string | undefined) => string;
  onOpen: (value: string) => void;
  emptyText?: string;
}) {
  return (
    <EntityColumnView
      sliced={false}
      rows={rows}
      colors={colors}
      stateLabel={stateLabel}
      onOpen={onOpen}
      emptyText={emptyText}
    />
  );
}
