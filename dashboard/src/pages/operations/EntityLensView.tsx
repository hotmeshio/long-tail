import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { RoleDetail } from '../../api/roles';
import {
  useAggregateByFacets,
  useAnalyticsWindow,
  isForbidden,
  type TimelineInterval,
} from '../../api/escalation-analytics';
import { useFacetKeys } from '../../api/escalations';
import { EntityTimelinePanel } from '../../components/escalation/EntityTimelinePanel';
import { useShellPanelOptional } from '../../hooks/useShellPanel';
import { assignLabelColors } from './mix-colors';
import { displayRoleTitle } from '../../lib/role-display';
import { formatDurationCompact } from '../../lib/format';
import { StateBand } from './StateBands';
import {
  SliceColumnLoader,
  SingleColumn,
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
} from './EntityColumns';
import { entityValues, pivotEntities, totalDwell, rankSliceValues } from './entity-pivot';
import { SEARCH_DEBOUNCE_MS } from '../../lib/realtime-refresh';

// Shared shell-panel slot key — the entity timeline claims/releases this slot.
const TIMELINE_PANEL_KEY = 'entity-timeline';
// The find input debounces into the URL-backed find term.
const FIND_DEBOUNCE_MS = SEARCH_DEBOUNCE_MS;
// A slice with more discrete values than this is not really categorical — cap
// the columns and say so, rather than sprawl.
const SLICE_VALUE_CAP = 12;

/**
 * The entity lens — the Operations page flipped station-first → entity-first.
 * One lens per entity facet the visible roles declare; roles sharing the key
 * form the entity's SYSTEM. Three intents, all URL-backed so a link (or the
 * upper-right bookmark) reproduces the exact view:
 *
 *   plain    — one dwell-ranked, paginated list of the whole system
 *   compare  — pick a categorical facet (?slice=): one column per value, each a
 *              bounded top-K snapshot with its own header timeline; no paging
 *   focus    — target one value (?sliceValue=): that value's full paginated
 *              list, where deep paging finally reads sanely
 *
 * Categorical metadata makes this efficient: the slice groups on a low-
 * cardinality key (few columns), and only the entity id — the unbounded axis —
 * is ever paged.
 */
export function EntityLensView({
  entityKey,
  periodHours,
  roles,
  scopeFacets,
  find,
  onFindChange,
  entityValue,
  onEntityChange,
  sliceKey: sliceKeyProp = null,
  onSliceKeyChange,
  sliceValue = null,
  onSliceValueChange,
}: {
  entityKey: string;
  periodHours: number;
  roles: RoleDetail[];
  /** Device-bound facet scope — narrows every lens query, like the board. */
  scopeFacets?: Record<string, unknown>;
  /** Debounced find term (?find=) — a case-insensitive prefix on the entity key. */
  find: string | null;
  onFindChange: (term: string | null) => void;
  /** Deep-linked entity (?entity=) — the timeline panel follows this value. */
  entityValue: string | null;
  onEntityChange: (value: string | null) => void;
  /** The chosen categorical facet (?slice=). Null/'' = no slice (plain). */
  sliceKey?: string | null;
  onSliceKeyChange?: (key: string | null) => void;
  /** The targeted slice value (?sliceValue=). Set = focus on that one value. */
  sliceValue?: string | null;
  onSliceValueChange?: (value: string | null) => void;
}) {
  const window = useAnalyticsWindow(periodHours);
  const shell = useShellPanelOptional();

  // Merge the device-bound facet scope into any query — every lens read is
  // narrowed to the same facets that scope the board and the pins.
  const scoped = <Q extends object>(q: Q): Q & { facets?: Record<string, unknown> } =>
    scopeFacets
      ? { ...q, facets: { ...((q as { facets?: Record<string, unknown> }).facets ?? {}), ...scopeFacets } }
      : q;
  const sliceKey = sliceKeyProp ?? '';
  const sliced = !!sliceKey;
  const focused = sliced && !!sliceValue;
  const compare = sliced && !sliceValue;

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // A page only means anything within one query shape — reset with it.
  useEffect(() => {
    setPage(0);
  }, [find, window.from, window.to, entityKey, sliceKey, sliceValue, pageSize]);

  // Find input: local state debounced into the URL-backed term (?find=).
  const [findInput, setFindInput] = useState(find ?? '');
  const findDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(findDebounce.current), []);
  useEffect(() => { setFindInput(find ?? ''); }, [find]);
  const handleFindInput = (value: string) => {
    setFindInput(value);
    clearTimeout(findDebounce.current);
    findDebounce.current = setTimeout(() => {
      const term = value.trim();
      onFindChange(term ? term : null);
    }, FIND_DEBOUNCE_MS);
  };

  const roleTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) map.set(r.role, displayRoleTitle(r));
    return map;
  }, [roles]);
  const stateLabel = (state: string | undefined) =>
    state == null ? '—' : roleTitles.get(state) ?? state;

  // Counts-only (public under the board flag): the system's state bands.
  const stateDwell = useAggregateByFacets({
    query: scoped({ entity: entityKey }),
    groupBy: { state: true },
    measure: { kind: 'dwell', window },
    orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
  });
  const stateNow = useAggregateByFacets({
    query: scoped({ entity: entityKey }),
    groupBy: { state: true },
    measure: { kind: 'membership' },
  });
  const entityCount = useAggregateByFacets({
    query: scoped({ entity: entityKey }),
    groupBy: {},
    measure: { kind: 'membership' },
    distinctBy: entityKey,
  });

  // Facet-grouped (strict read gate): the categorical slice — column values +
  // each value's header timeline. Runs whenever a slice is chosen.
  const slice = useAggregateByFacets(
    sliced
      ? {
          query: scoped({ entity: entityKey }),
          groupBy: { state: true, facets: [sliceKey] },
          measure: { kind: 'dwell', window },
          limit: 200,
        }
      : null,
  );

  // The paginated ranking — plain and focus only (compare fetches per column).
  // Focus scopes to the targeted value with a single-element anyOf (equality).
  const pagedActive = !compare;
  const perEntity = useAggregateByFacets(
    pagedActive
      ? {
          query: scoped({
            entity: entityKey,
            // Focus scopes to the targeted value by exact text match (the value
            // came from the aggregate as text; equals round-trips every scalar).
            ...(focused ? { equals: { [sliceKey]: sliceValue as string } } : {}),
            ...(find ? { prefix: { [entityKey]: find } } : {}),
          }),
          groupBy: { facets: [entityKey] },
          measure: { kind: 'dwell', window },
          orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
          limit: pageSize,
          offset: page * pageSize,
        }
      : null,
  );
  const pageValues = useMemo(
    () => entityValues(perEntity?.data?.groups ?? [], entityKey),
    [perEntity?.data, entityKey],
  );
  const pageScope = pageValues.length
    ? { entity: entityKey, anyOf: pageValues.map((v) => ({ [entityKey]: v })) }
    : null;
  const perEntityStates = useAggregateByFacets(
    pageScope
      ? {
          query: scoped(pageScope),
          groupBy: { state: true, facets: [entityKey] },
          measure: { kind: 'dwell', window },
          limit: pageSize * 10,
        }
      : null,
  );
  const perEntityNow = useAggregateByFacets(
    pageScope
      ? { query: scoped(pageScope), groupBy: { state: true, facets: [entityKey] }, measure: { kind: 'membership' } }
      : null,
  );
  const entityRows = useMemo(
    () =>
      pivotEntities(
        perEntity?.data?.groups ?? [],
        perEntityStates.data?.groups ?? [],
        perEntityNow.data?.groups ?? [],
        entityKey,
      ),
    [perEntity?.data, perEntityStates.data, perEntityNow.data, entityKey],
  );

  // Color resolver handed to the timeline panel so its interval dots use the
  // EXACT colors of this graphic's band — same map, same state derivation. A
  // ref keeps it fresh (colors load after the panel may have opened) while the
  // identity stays stable, so the panel is set once and never re-mounted.
  const intervalColorRef = useRef<(iv: TimelineInterval) => string | undefined>(() => undefined);
  const intervalColor = useRef((iv: TimelineInterval) => intervalColorRef.current(iv)).current;

  // ── ?entity= ↔ timeline panel sync ──────────────────────────────────────────
  const appliedEntity = useRef<string | null>(null);
  const panelWasOpen = useRef(false);
  useEffect(() => {
    if (!shell) return;
    if (entityValue === appliedEntity.current) return;
    appliedEntity.current = entityValue;
    if (entityValue) {
      shell.setPanel(
        <EntityTimelinePanel facetKey={entityKey} value={entityValue} entity={entityKey} intervalColor={intervalColor} />,
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

  // Keep the panel's color resolver current. State derivation mirrors the
  // server's stateExpr: subtype-sourced roles are COALESCE(subtype, role),
  // everyone else IS their role — the same key the `colors` map is built on.
  const subtypeSourcedRoles = useMemo(
    () => new Set(roles.filter((r) => r.entity_state_source === 'subtype').map((r) => r.role)),
    [roles],
  );
  intervalColorRef.current = (iv) => {
    const state = subtypeSourcedRoles.has(iv.role) ? (iv.subtype ?? iv.role) : iv.role;
    return colors.get(state);
  };

  // Compare columns: the ranked slice values (bounded — a too-big facet is a smell).
  const rankedSlices = useMemo(
    () => (sliced ? rankSliceValues(slice.data?.groups ?? [], sliceKey, SLICE_VALUE_CAP) : []),
    [sliced, slice.data, sliceKey],
  );
  const distinctSliceValues = useMemo(() => {
    const set = new Set<string>();
    for (const g of slice.data?.groups ?? []) {
      if ((g.dwellSeconds ?? 0) > 0 && g.facets[sliceKey] != null) set.add(g.facets[sliceKey] as string);
    }
    return set.size;
  }, [slice.data, sliceKey]);

  // Focused value's own timeline (for the breadcrumb band).
  const focusedBand = useMemo(() => {
    if (!focused) return { groups: [], total: 0 };
    const groups = (slice.data?.groups ?? []).filter((g) => g.facets[sliceKey] === sliceValue);
    return { groups, total: totalDwell(groups) };
  }, [focused, slice.data, sliceKey, sliceValue]);

  const overflow = perEntity?.data?.overflow ?? false;
  const perEntityForbidden = isForbidden(perEntity?.error);
  const sliceForbidden = sliced && isForbidden(slice.error);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Top bar: the system band shares the row with the slice + find controls ── */}
      <div className="shrink-0 px-2 pt-4 pb-3 flex items-start gap-6 border-b border-surface-border/40">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-4 mb-2.5">
            <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
              Where the time went · <span className="normal-case font-mono">{entityKey}</span> system
            </p>
            {tracked != null && (
              <p className="text-2xs text-text-quaternary whitespace-nowrap">
                <span className="text-xs font-mono font-semibold text-text-primary tabular-nums">{tracked}</span>{' '}
                <span className="font-mono">{entityKey}</span> in queue now
              </p>
            )}
          </div>
          {dwellGroups.length > 0 ? (
            <>
              <StateBand groups={dwellGroups} colors={colors} height="h-3" />
              {/* Dot + label only — the proportions are the band; specifics live on hover. */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
                {dwellGroups.map((g) => {
                  const now = nowByState.get(g.state ?? '—') ?? 0;
                  const pct = Math.round(((g.dwellSeconds ?? 0) / totalDwell(dwellGroups)) * 100);
                  const detail = `${formatDurationCompact((g.dwellSeconds ?? 0) * 1000)} · ${pct}%${now > 0 ? ` · ${now} now` : ''}`;
                  return (
                    <span key={g.state} className="flex items-center gap-1.5 text-2xs" title={detail}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors.get(g.state ?? '—') }} />
                      <span className="font-mono text-text-secondary">{stateLabel(g.state)}</span>
                    </span>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-2xs text-text-quaternary">No tracked time in this window.</p>
          )}
        </div>

        {/* Slice + find — the band no longer runs full width. */}
        <div className="shrink-0 w-56 space-y-2.5">
          <label className="block">
            <span className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">Slice by</span>
            <select
              value={sliceKey}
              onChange={(e) => onSliceKeyChange?.(e.target.value || null)}
              className="select text-xs font-mono w-full"
            >
              <option value="">— none —</option>
              {sliceOptions.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <input
            type="text"
            value={findInput}
            onChange={(e) => handleFindInput(e.target.value)}
            placeholder={`Find by ${entityKey}…`}
            aria-label={`Find by ${entityKey}`}
            className="w-full bg-transparent border-b border-surface-border/60 focus:border-accent focus:outline-none text-xs font-mono text-text-primary placeholder:text-text-quaternary pb-0.5 transition-colors"
          />
        </div>
      </div>

      {/* ── Focus breadcrumb: the targeted value's timeline + a way back to compare ── */}
      {focused && (
        <div className="shrink-0 px-2 pt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSliceValueChange?.(null)}
            className="inline-flex items-center gap-1 text-2xs text-accent hover:text-accent-hover transition-colors shrink-0"
          >
            <ChevronLeft className="w-3 h-3" /> all {sliceKey}
          </button>
          <span className="font-mono text-xs text-text-primary shrink-0">{sliceValue}</span>
          <StateBand groups={focusedBand.groups} colors={colors} height="h-2" className="flex-1 max-w-md" />
          <span className="font-mono tabular-nums text-2xs text-text-tertiary shrink-0">
            {formatDurationCompact(focusedBand.total * 1000)}
          </span>
        </div>
      )}

      {/* ── The columns — compare (one per value) or a single wide list ── */}
      <div className="flex-1 min-h-0 overflow-auto px-2 py-4">
        {compare ? (
          sliceForbidden ? (
            <p className="text-2xs text-text-quaternary">Slicing requires full read access to the system's queues.</p>
          ) : rankedSlices.length === 0 ? (
            <p className="text-2xs text-text-quaternary">No tracked time for this slice in the window.</p>
          ) : (
            <>
              <div className="flex gap-6 min-w-max">
                {rankedSlices.map((s) => (
                  <SliceColumnLoader
                    key={s.value}
                    entityKey={entityKey}
                    sliceKey={sliceKey}
                    value={s.value}
                    headerGroups={s.groups}
                    headerTotal={s.total}
                    window={window}
                    find={find}
                    colors={colors}
                    stateLabel={stateLabel}
                    onOpen={onEntityChange}
                    onTarget={(v) => onSliceValueChange?.(v)}
                  />
                ))}
              </div>
              {distinctSliceValues > SLICE_VALUE_CAP && (
                <p className="text-2xs text-text-quaternary pt-4">
                  Showing the top {SLICE_VALUE_CAP} of {distinctSliceValues} <span className="font-mono">{sliceKey}</span> values —
                  a facet this wide isn't a good slice dimension.
                </p>
              )}
            </>
          )
        ) : perEntityForbidden ? (
          <p className="text-2xs text-text-quaternary">
            The per-entity view requires full read access to the system's queues.
          </p>
        ) : (
          <SingleColumn
            facetKey={entityKey}
            rows={entityRows}
            colors={colors}
            stateLabel={stateLabel}
            onOpen={onEntityChange}
            emptyText={find ? `No ${entityKey} starts with “${find}” in this window.` : 'No entities tracked in this window.'}
          />
        )}
      </div>

      {/* ── Pager — persistent in the paginated contexts (plain + focus), not compare ── */}
      {!compare && (
        <div className="shrink-0 border-t border-surface-border bg-surface/95 px-2 pt-2 pb-3 flex items-center gap-3 text-2xs">
          <button
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="text-text-tertiary hover:text-accent transition-colors disabled:opacity-40 disabled:hover:text-text-tertiary"
          >
            Prev
          </button>
          <span className="font-mono tabular-nums text-text-quaternary">page {page + 1}</span>
          <button
            disabled={!overflow}
            onClick={() => setPage(page + 1)}
            className="text-text-tertiary hover:text-accent transition-colors disabled:opacity-40 disabled:hover:text-text-tertiary"
          >
            Next
          </button>
          <span className="ml-auto flex items-center gap-1.5 text-text-quaternary">
            <span>per page</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Results per page"
              className="select text-2xs font-mono py-0.5"
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </span>
        </div>
      )}
    </div>
  );
}
