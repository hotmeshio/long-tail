import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { RoleDetail } from '../../api/roles';
import {
  useAggregateByFacets,
  useAnalyticsWindow,
  isForbidden,
  type AggregateRow,
} from '../../api/escalation-analytics';
import { useFacetKeys } from '../../api/escalations';
import { EntityTimelinePanel } from '../../components/escalation/EntityTimelinePanel';
import { useShellPanelOptional } from '../../hooks/useShellPanel';
import { assignLabelColors } from './mix-colors';
import { displayRoleTitle } from '../../lib/role-display';
import { formatDurationCompact } from '../../lib/format';

/**
 * The entity lens — the Operations page flipped from station-first to
 * entity-first. One lens per entity facet the visible roles declare; roles
 * sharing the key form the entity's SYSTEM, and each role contributes states
 * per its entity_state_source. Three tiers, aggregate → individual:
 *
 *   the system band   how the fleet's time splits across states
 *   the slice row     the same band per value of any metadata key (h2s vs pdac)
 *   the entity table  one row per entity: current state, its own band, timeline
 *
 * State labels arrive from the server (groupBy.state); role-sourced labels are
 * prettied through the role title, subtype-sourced labels render as authored.
 */
export function EntityLensView({
  entityKey,
  periodHours,
  roles,
}: {
  entityKey: string;
  periodHours: number;
  roles: RoleDetail[];
}) {
  const window = useAnalyticsWindow(periodHours);
  const shell = useShellPanelOptional();
  const [sliceKey, setSliceKey] = useState('');

  const roleTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) map.set(r.role, displayRoleTitle(r));
    return map;
  }, [roles]);
  const stateLabel = (state: string | undefined) =>
    state == null ? '—' : roleTitles.get(state) ?? state;

  // Counts-only (public under the board flag): the system's state bands.
  const stateDwell = useAggregateByFacets({
    query: { entity: entityKey },
    groupBy: { state: true },
    measure: { kind: 'dwell', window },
    orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
  });
  const stateNow = useAggregateByFacets({
    query: { entity: entityKey },
    groupBy: { state: true },
    measure: { kind: 'membership' },
  });
  const entityCount = useAggregateByFacets({
    query: { entity: entityKey },
    groupBy: {},
    measure: { kind: 'membership' },
    distinctBy: entityKey,
  });

  // Facet-grouped (strict read gate): the categorical slice + per-entity rows.
  const slice = useAggregateByFacets(
    sliceKey
      ? {
          query: { entity: entityKey },
          groupBy: { state: true, facets: [sliceKey] },
          measure: { kind: 'dwell', window },
          limit: 200,
        }
      : null,
  );
  const perEntity = useAggregateByFacets({
    query: { entity: entityKey },
    groupBy: { state: true, facets: [entityKey] },
    measure: { kind: 'dwell', window },
    limit: 800,
  });
  const perEntityNow = useAggregateByFacets({
    query: { entity: entityKey },
    groupBy: { state: true, facets: [entityKey] },
    measure: { kind: 'membership' },
    limit: 800,
  });

  const { data: facetKeyData } = useFacetKeys();
  const sliceOptions = useMemo(
    () => ((facetKeyData?.keys as string[] | undefined) ?? []).filter((k) => k !== entityKey),
    [facetKeyData, entityKey],
  );

  const dwellGroups = (stateDwell.data?.groups ?? []).filter((g) => (g.dwellSeconds ?? 0) > 0);
  const colors = useMemo(
    () =>
      assignLabelColors(
        [...dwellGroups, ...(stateNow.data?.groups ?? [])].map((g) => ({
          label: g.state ?? '—',
          weight: g.dwellSeconds ?? g.count ?? 0,
        })),
      ),
    [dwellGroups, stateNow.data],
  );
  const nowByState = new Map((stateNow.data?.groups ?? []).map((g) => [g.state ?? '—', g.count ?? 0]));
  const tracked = entityCount.data?.groups[0]?.count ?? null;

  const openTimeline = (value: string) =>
    shell?.setPanel(
      <EntityTimelinePanel facetKey={entityKey} value={value} entity={entityKey} />,
      { key: 'entity-timeline', width: 420 },
    );

  const entityRows = useMemo(
    () => pivotEntities(perEntity.data?.groups ?? [], perEntityNow.data?.groups ?? [], entityKey),
    [perEntity.data, perEntityNow.data, entityKey],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4 space-y-8">
      {/* ── The system band ── */}
      <div>
        <div className="flex items-baseline justify-between mb-2.5">
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Where the time went · <span className="normal-case font-mono">{entityKey}</span> system
          </p>
          {tracked != null && (
            <p className="text-2xs text-text-quaternary">
              <span className="text-xs font-mono font-semibold text-text-primary tabular-nums">{tracked}</span>{' '}
              <span className="font-mono">{entityKey}</span> in queue now
            </p>
          )}
        </div>
        {dwellGroups.length > 0 ? (
          <>
            <StateBand groups={dwellGroups} colors={colors} height="h-3" />
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2.5">
              {dwellGroups.map((g) => (
                <span key={g.state} className="flex items-center gap-1.5 text-2xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors.get(g.state ?? '—') }} />
                  <span className="font-mono text-text-secondary">{stateLabel(g.state)}</span>
                  <span className="font-mono tabular-nums text-text-tertiary">
                    {formatDurationCompact((g.dwellSeconds ?? 0) * 1000)}
                  </span>
                  <span className="font-mono tabular-nums text-text-quaternary">
                    {Math.round(((g.dwellSeconds ?? 0) / totalDwell(dwellGroups)) * 100)}%
                  </span>
                  {(nowByState.get(g.state ?? '—') ?? 0) > 0 && (
                    <span className="text-text-quaternary">· {nowByState.get(g.state ?? '—')} now</span>
                  )}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-2xs text-text-quaternary">No tracked time in this window.</p>
        )}
      </div>

      {/* ── The slice row ── */}
      <div className="border-t border-surface-border/40 pt-5">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">Slice by</p>
          <select
            value={sliceKey}
            onChange={(e) => setSliceKey(e.target.value)}
            className="select text-xs font-mono w-48"
          >
            <option value="">— none —</option>
            {sliceOptions.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        {sliceKey && (
          isForbidden(slice.error) ? (
            <p className="text-2xs text-text-quaternary">Slicing requires full read access to the system's queues.</p>
          ) : (
            <SliceBands groups={slice.data?.groups ?? []} sliceKey={sliceKey} colors={colors} overflow={slice.data?.overflow} />
          )
        )}
      </div>

      {/* ── The entity table ── */}
      <div className="border-t border-surface-border/40 pt-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-3">
          By <span className="normal-case font-mono">{entityKey}</span> — top by tracked time
        </p>
        {isForbidden(perEntity.error) ? (
          <p className="text-2xs text-text-quaternary">
            The per-entity view requires full read access to the system's queues.
          </p>
        ) : entityRows.length === 0 ? (
          <p className="text-2xs text-text-quaternary">No entities tracked in this window.</p>
        ) : (
          <div className="space-y-1 max-w-3xl">
            {entityRows.map((row) => (
              <div key={row.value} className="flex items-center gap-3 text-2xs">
                <span className="font-mono text-text-secondary truncate w-44 shrink-0" title={row.value}>
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
                <button className="icon-link shrink-0" title="Open timeline" onClick={() => openTimeline(row.value)}>
                  <History className="w-3 h-3" />
                </button>
              </div>
            ))}
            {perEntity.data?.overflow && (
              <p className="text-2xs text-text-quaternary pt-1">more entities exist — narrow the window</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function totalDwell(groups: AggregateRow[]): number {
  return groups.reduce((sum, g) => sum + (g.dwellSeconds ?? 0), 0) || 1;
}

/** One stacked band of state dwell. */
function StateBand({
  groups,
  colors,
  height,
  className = '',
}: {
  groups: AggregateRow[];
  colors: Map<string, string>;
  height: string;
  className?: string;
}) {
  const total = totalDwell(groups);
  return (
    <div className={`${height} flex rounded-full overflow-hidden bg-surface-sunken ${className}`}>
      {groups.map((g) => (
        <div
          key={g.state ?? '—'}
          title={`${g.state ?? '—'} · ${formatDurationCompact((g.dwellSeconds ?? 0) * 1000)}`}
          style={{ width: `${((g.dwellSeconds ?? 0) / total) * 100}%`, backgroundColor: colors.get(g.state ?? '—') }}
        />
      ))}
    </div>
  );
}

/** Small-multiple bands, one per slice value, ranked by total dwell. */
function SliceBands({
  groups,
  sliceKey,
  colors,
  overflow,
}: {
  groups: AggregateRow[];
  sliceKey: string;
  colors: Map<string, string>;
  overflow?: boolean;
}) {
  const byValue = new Map<string, AggregateRow[]>();
  for (const g of groups) {
    if ((g.dwellSeconds ?? 0) <= 0) continue;
    const value = g.facets[sliceKey] ?? 'no value';
    const rows = byValue.get(value) ?? [];
    rows.push(g);
    byValue.set(value, rows);
  }
  const ranked = [...byValue.entries()]
    .map(([value, rows]) => ({ value, rows, total: totalDwell(rows) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  if (ranked.length === 0) {
    return <p className="text-2xs text-text-quaternary">No tracked time for this slice in the window.</p>;
  }
  return (
    <div className="space-y-1.5 max-w-3xl">
      {ranked.map(({ value, rows, total }) => (
        <div key={value} className="flex items-center gap-3 text-2xs">
          <span className="font-mono text-text-secondary truncate w-44 shrink-0" title={value}>{value}</span>
          <StateBand groups={rows} colors={colors} height="h-2" className="flex-1" />
          <span className="font-mono tabular-nums text-text-secondary w-16 text-right shrink-0">
            {formatDurationCompact(total * 1000)}
          </span>
        </div>
      ))}
      {(overflow || byValue.size > 8) && (
        <p className="text-2xs text-text-quaternary pt-1">top 8 values by tracked time</p>
      )}
    </div>
  );
}

/** Pivot (entityValue × state) rows into per-entity bands + current state. */
function pivotEntities(
  dwellGroups: AggregateRow[],
  nowGroups: AggregateRow[],
  entityKey: string,
): Array<{ value: string; groups: AggregateRow[]; total: number; nowState: string | null }> {
  const byValue = new Map<string, AggregateRow[]>();
  for (const g of dwellGroups) {
    const value = g.facets[entityKey];
    if (value == null || (g.dwellSeconds ?? 0) <= 0) continue;
    const rows = byValue.get(value) ?? [];
    rows.push(g);
    byValue.set(value, rows);
  }
  const nowByValue = new Map<string, string>();
  for (const g of nowGroups) {
    const value = g.facets[entityKey];
    if (value == null || (g.count ?? 0) <= 0 || g.state == null) continue;
    // Multiple live states for one entity is a model smell; surface the largest.
    const existing = nowByValue.get(value);
    if (!existing) nowByValue.set(value, g.state);
  }
  return [...byValue.entries()]
    .map(([value, rows]) => ({
      value,
      groups: [...rows].sort((a, b) => (b.dwellSeconds ?? 0) - (a.dwellSeconds ?? 0)),
      total: rows.reduce((sum, g) => sum + (g.dwellSeconds ?? 0), 0),
      nowState: nowByValue.get(value) ?? null,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 50);
}
