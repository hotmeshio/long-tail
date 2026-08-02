import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoleDetail } from '../../api/roles';
import {
  useAggregateByFacets,
  useAnalyticsWindow,
  isForbidden,
} from '../../api/escalation-analytics';
import { useFacetKeys } from '../../api/escalations';
import { EntityTimelinePanel } from '../../components/escalation/EntityTimelinePanel';
import { useShellPanelOptional } from '../../hooks/useShellPanel';
import { assignLabelColors } from './mix-colors';
import { displayRoleTitle } from '../../lib/role-display';
import { formatDurationCompact } from '../../lib/format';
import { StateBand, SliceBands } from './StateBands';
import { EntityTable, ENTITY_PAGE_SIZE } from './EntityTable';
import { entityValues, pivotEntities, totalDwell } from './entity-pivot';

// Shared shell-panel slot key — the entity timeline claims/releases this slot.
const TIMELINE_PANEL_KEY = 'entity-timeline';

/**
 * The entity lens — the Operations page flipped from station-first to
 * entity-first. One lens per entity facet the visible roles declare; roles
 * sharing the key form the entity's SYSTEM, and each role contributes states
 * per its entity_state_source. Three tiers, aggregate → individual:
 *
 *   the system band   how the fleet's time splits across states
 *   the slice row     the same band per value of any metadata key (h2s vs pdac)
 *   the entity table  one dwell-ranked PAGE of entities: find (prefix match),
 *                     current state, own band, timeline — built for a
 *                     multi-thousand-entity fleet, never a full pull
 *
 * The find term and the open timeline are URL-backed (?find=, ?entity=) —
 * owned by OperationsPage and passed down — so links reproduce the view and
 * back/forward walks it.
 *
 * State labels arrive from the server (groupBy.state); role-sourced labels are
 * prettied through the role title, subtype-sourced labels render as authored.
 */
export function EntityLensView({
  entityKey,
  periodHours,
  roles,
  find,
  onFindChange,
  entityValue,
  onEntityChange,
}: {
  entityKey: string;
  periodHours: number;
  roles: RoleDetail[];
  /** Debounced find term (?find=) — a case-insensitive prefix on the entity key. */
  find: string | null;
  onFindChange: (term: string | null) => void;
  /** Deep-linked entity (?entity=) — the timeline panel follows this value. */
  entityValue: string | null;
  onEntityChange: (value: string | null) => void;
}) {
  const window = useAnalyticsWindow(periodHours);
  const shell = useShellPanelOptional();
  const [sliceKey, setSliceKey] = useState('');
  const [page, setPage] = useState(0);

  // A page only means anything within one query shape — reset with it.
  useEffect(() => {
    setPage(0);
  }, [find, window.from, window.to, entityKey]);

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

  // The RANKING query: one row per entity (grouped by the entity facet alone),
  // ordered by TOTAL tracked time — so a page is exactly ENTITY_PAGE_SIZE
  // entities, none straddling a boundary, ranked by their whole dwell. The
  // find term narrows via prefix; the pager offsets — filtering and paging
  // are server-side, always.
  const perEntity = useAggregateByFacets({
    query: { entity: entityKey, ...(find ? { prefix: { [entityKey]: find } } : {}) },
    groupBy: { facets: [entityKey] },
    measure: { kind: 'dwell', window },
    orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
    limit: ENTITY_PAGE_SIZE,
    offset: page * ENTITY_PAGE_SIZE,
  });
  const pageValues = useMemo(
    () => entityValues(perEntity.data?.groups ?? [], entityKey),
    [perEntity.data, entityKey],
  );
  // The page's state splits and current states — anyOf targets its entities.
  const pageScope = pageValues.length
    ? { entity: entityKey, anyOf: pageValues.map((v) => ({ [entityKey]: v })) }
    : null;
  const perEntityStates = useAggregateByFacets(
    pageScope
      ? {
          query: pageScope,
          groupBy: { state: true, facets: [entityKey] },
          measure: { kind: 'dwell', window },
          limit: ENTITY_PAGE_SIZE * 10,
        }
      : null,
  );
  const perEntityNow = useAggregateByFacets(
    pageScope
      ? {
          query: pageScope,
          groupBy: { state: true, facets: [entityKey] },
          measure: { kind: 'membership' },
        }
      : null,
  );
  const entityRows = useMemo(
    () =>
      pivotEntities(
        perEntity.data?.groups ?? [],
        perEntityStates.data?.groups ?? [],
        perEntityNow.data?.groups ?? [],
        entityKey,
      ),
    [perEntity.data, perEntityStates.data, perEntityNow.data, entityKey],
  );

  // ── ?entity= ↔ timeline panel sync ──────────────────────────────────────────
  // The param is the source of truth: a change (row click, link, back/forward)
  // opens/closes the panel; an external close (the panel's X, slot takeover)
  // clears the param. Refs guard both directions against loops.
  const appliedEntity = useRef<string | null>(null);
  const panelWasOpen = useRef(false);
  useEffect(() => {
    if (!shell) return;
    if (entityValue === appliedEntity.current) return;
    appliedEntity.current = entityValue;
    if (entityValue) {
      shell.setPanel(
        <EntityTimelinePanel facetKey={entityKey} value={entityValue} entity={entityKey} />,
        { key: TIMELINE_PANEL_KEY, width: 420 },
      );
    } else {
      panelWasOpen.current = false;
      shell.closePanel(TIMELINE_PANEL_KEY);
    }
  }, [entityValue, entityKey, shell]);
  useEffect(() => {
    if (!shell || !entityValue) return;
    if (shell.open && shell.ownerKey === TIMELINE_PANEL_KEY) {
      panelWasOpen.current = true;
      return;
    }
    if (panelWasOpen.current) {
      panelWasOpen.current = false;
      onEntityChange(null);
    }
  }, [shell, entityValue, onEntityChange]);
  // Leaving the lens with the panel open (lens switch) releases the slot.
  const shellRef = useRef(shell);
  shellRef.current = shell;
  useEffect(
    () => () => {
      if (appliedEntity.current) shellRef.current?.closePanel(TIMELINE_PANEL_KEY);
    },
    [],
  );

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
        ) : (
          <EntityTable
            entityKey={entityKey}
            rows={entityRows}
            colors={colors}
            stateLabel={stateLabel}
            find={find}
            onFindChange={onFindChange}
            page={page}
            onPageChange={setPage}
            overflow={perEntity.data?.overflow ?? false}
            onEntityOpen={onEntityChange}
          />
        )}
      </div>
    </div>
  );
}
