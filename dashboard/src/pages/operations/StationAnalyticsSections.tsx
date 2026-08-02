import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { History, ChevronRight, ChevronDown, ArrowUpRight } from 'lucide-react';
import type { RoleDetail } from '../../api/roles';
import {
  useAggregateByFacets,
  useAnalyticsWindow,
  isForbidden,
} from '../../api/escalation-analytics';
import { assignMixColors, subtypeKey, subtypeLabel } from './mix-colors';
import { formatDurationCompact } from '../../lib/format';

/**
 * The station detail panel's analytics sections — the drill-down behind the
 * table's MIX bar:
 *
 *   "Where the time went"  dwell by subtype over the panel's window
 *   "In queue now"         live membership by subtype; with entity_facet, a
 *                          distinct-entity headline and a lazy per-entity
 *                          dwell list with timeline links
 *
 * Color assignment is shared across both sections so a subtype's dot means
 * the same thing in the bar and the queue list.
 */
export function StationAnalyticsSections({
  role,
  periodHours,
  onOpenEntity,
}: {
  role: RoleDetail;
  periodHours: number;
  onOpenEntity: (facetKey: string, value: string) => void;
}) {
  const window = useAnalyticsWindow(periodHours);
  const entityFacet = role.entity_facet;
  const [showEntities, setShowEntities] = useState(false);
  const [, setSearchParams] = useSearchParams();
  // The headline is the doorway to the entity lens — the board flipped
  // entity-first, where the whole system (not just this station) is the view.
  const openLens = () => {
    if (!entityFacet) return;
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('lens', entityFacet);
      return p;
    });
  };

  const dwell = useAggregateByFacets({
    query: { roles: [role.role] },
    groupBy: { columns: ['subtype'] },
    measure: { kind: 'dwell', window },
    orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
  });
  const queueNow = useAggregateByFacets({
    query: { roles: [role.role] },
    groupBy: { columns: ['subtype'] },
    measure: { kind: 'membership' },
    orderBy: [{ field: 'count', direction: 'desc' }],
  });
  const distinctEntities = useAggregateByFacets(
    entityFacet
      ? {
          query: { roles: [role.role] },
          groupBy: {},
          measure: { kind: 'membership' },
          distinctBy: entityFacet,
        }
      : null,
  );
  // Facet-grouped ⇒ always behind the strict read gate; fetched on disclosure.
  const perEntity = useAggregateByFacets(
    entityFacet && showEntities
      ? {
          query: { roles: [role.role], exists: [entityFacet] },
          groupBy: { facets: [entityFacet] },
          measure: { kind: 'dwell', window },
          orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
          limit: 8,
        }
      : null,
  );

  const colors = useMemo(
    () => assignMixColors([...(dwell.data?.groups ?? []), ...(queueNow.data?.groups ?? [])]),
    [dwell.data, queueNow.data],
  );

  if (isForbidden(dwell.error)) {
    return (
      <div className="border-t border-surface-border/40 pt-4 mt-5">
        <p className="text-2xs text-text-quaternary">
          Analytics require full read access to this station's queue.
        </p>
      </div>
    );
  }

  const dwellGroups = (dwell.data?.groups ?? []).filter((g) => (g.dwellSeconds ?? 0) > 0);
  const totalDwell = dwellGroups.reduce((sum, g) => sum + (g.dwellSeconds ?? 0), 0);
  const queueGroups = (queueNow.data?.groups ?? []).filter((g) => (g.count ?? 0) > 0);
  const entityCount = distinctEntities.data?.groups[0]?.count ?? null;

  return (
    <>
      {/* Where the time went — dwell mix over the panel's window */}
      <div className="border-t border-surface-border/40 pt-4 mt-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2.5">
          Where the time went
        </p>
        {totalDwell > 0 ? (
          <>
            <div className="h-2 flex rounded-full overflow-hidden bg-surface-sunken mb-2.5">
              {dwellGroups.map((g) => (
                <div
                  key={subtypeKey(g.subtype)}
                  style={{
                    width: `${((g.dwellSeconds ?? 0) / totalDwell) * 100}%`,
                    backgroundColor: colors.get(subtypeKey(g.subtype)),
                  }}
                />
              ))}
            </div>
            <div className="space-y-1">
              {dwellGroups.map((g) => (
                <div key={subtypeKey(g.subtype)} className="flex items-center gap-2 text-2xs">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: colors.get(subtypeKey(g.subtype)) }}
                  />
                  <span
                    className={`font-mono truncate flex-1 ${
                      g.subtype ? 'text-text-secondary' : 'text-text-tertiary'
                    }`}
                  >
                    {subtypeLabel(g.subtype)}
                  </span>
                  <span className="font-mono tabular-nums text-text-secondary shrink-0">
                    {formatDurationCompact((g.dwellSeconds ?? 0) * 1000)}
                  </span>
                  <span className="font-mono tabular-nums text-text-quaternary w-8 text-right shrink-0">
                    {Math.round(((g.dwellSeconds ?? 0) / totalDwell) * 100)}%
                  </span>
                </div>
              ))}
            </div>
            {dwell.data?.overflow && (
              <p className="text-2xs text-text-quaternary mt-1.5">more groups exist — narrow the window</p>
            )}
          </>
        ) : (
          <p className="text-2xs text-text-quaternary">No tracked time in this window.</p>
        )}
      </div>

      {/* In queue now — live membership by subtype (+ entity headline) */}
      <div className="border-t border-surface-border/40 pt-4 mt-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2.5">
          In queue now
        </p>
        {entityFacet && entityCount != null && (
          <button
            onClick={openLens}
            className="group flex items-center gap-1 text-2xs mb-2 text-left"
            title={`Open the ${entityFacet} lens — the whole system, entity-first`}
          >
            <span className="text-xs font-mono font-semibold text-text-primary tabular-nums">
              {entityCount}
            </span>{' '}
            <span className="font-mono text-text-tertiary group-hover:text-accent transition-colors">{entityFacet}</span>
            <span className="text-text-quaternary"> in queue</span>
            <ArrowUpRight className="w-3 h-3 text-text-quaternary group-hover:text-accent transition-colors" />
          </button>
        )}
        {queueGroups.length > 0 ? (
          <div className="space-y-1">
            {queueGroups.map((g) => (
              <div key={subtypeKey(g.subtype)} className="flex items-center gap-2 text-2xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: colors.get(subtypeKey(g.subtype)) }}
                />
                <span
                  className={`font-mono truncate flex-1 ${
                    g.subtype ? 'text-text-secondary' : 'text-text-tertiary'
                  }`}
                >
                  {subtypeLabel(g.subtype)}
                </span>
                <span className="font-mono tabular-nums text-text-primary shrink-0">{g.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-text-quaternary">Queue clear.</p>
        )}

        {/* By entity — facet-grouped dwell (strict gate), fetched on disclosure */}
        {entityFacet && (
          <div className="mt-3">
            <button
              onClick={() => setShowEntities((v) => !v)}
              className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-accent transition-colors"
            >
              {showEntities ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              By entity
            </button>
            {showEntities && (
              isForbidden(perEntity.error) ? (
                <p className="text-2xs text-text-quaternary mt-1.5">
                  Requires full read access to this station's queue.
                </p>
              ) : (
                <div className="space-y-1 mt-1.5">
                  {(perEntity.data?.groups ?? []).map((g) => {
                    const value = g.facets[entityFacet];
                    if (value == null) return null;
                    return (
                      <div key={value} className="flex items-center gap-2 text-2xs">
                        <span className="font-mono truncate flex-1 text-text-secondary" title={value}>
                          {value}
                        </span>
                        <span className="font-mono tabular-nums text-text-secondary shrink-0">
                          {formatDurationCompact((g.dwellSeconds ?? 0) * 1000)}
                        </span>
                        <button
                          className="icon-link shrink-0"
                          title="Open timeline"
                          onClick={() => onOpenEntity(entityFacet, value)}
                        >
                          <History className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                  {perEntity.data && perEntity.data.groups.length === 0 && (
                    <p className="text-2xs text-text-quaternary">No entities in this window.</p>
                  )}
                  {perEntity.data?.overflow && (
                    <p className="text-2xs text-text-quaternary">top 8 by dwell</p>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </>
  );
}
