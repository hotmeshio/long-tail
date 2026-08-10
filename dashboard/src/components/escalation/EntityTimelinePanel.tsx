import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Link as LinkIcon, Search, ArrowDown, ArrowUp } from 'lucide-react';
import {
  useTimelineByFacet,
  fetchTimelineByFacet,
  isForbidden,
  type AnalyticsFilter,
  type TimelineInterval,
} from '../../api/escalation-analytics';
import { useEscalationAnalyticsEvents } from '../../hooks/useEventHooks';
import { useShellPanel } from '../../hooks/useShellPanel';
import { formatDateTime, formatDurationCompact } from '../../lib/format';
import { metadataFacetUrl } from '../../lib/facet-url';
import { assignLabelColors } from '../../pages/operations/mix-colors';
import { useEntityStateColors } from '../../pages/operations/useEntityStateColors';

/** The category a row belongs to — its state within the process (subtype),
 *  falling back to the role. This is the axis the timeline graphic colors by,
 *  NOT the escalation lifecycle (resolved/expired) which would be near-uniform
 *  across a mostly-completed history. */
const categoryOf = (iv: TimelineInterval): string => iv.subtype ?? iv.role;

// Newest page size — the head query and every "load earlier" page.
const TIMELINE_PAGE_SIZE = 100;

/**
 * One entity's escalation-interval timeline — every station the facet value
 * has moved through, as [started, ended) spans rendered chronologically. Gaps
 * between consecutive intervals are untracked time and render as explicit
 * separators: their size is the digital/physical settle latency, a health
 * signal, never hidden.
 *
 * The head query fetches the NEWEST page (order desc) so push-driven
 * invalidation keeps the recent end fresh; older pages accumulate locally via
 * the "Load earlier" cursor (`before` = oldest loaded startedAt) and reset
 * whenever the head page changes.
 *
 * Rendered in the global shell right panel (key 'entity-timeline'). Passing
 * `role` keeps the query inside the pond gate for read_all members; without
 * it the query is cross-role and needs a global principal — a 403 degrades to
 * a quiet scope notice.
 */
export function EntityTimelinePanel({
  facetKey,
  value,
  role,
  entity,
  intervalColor,
}: {
  facetKey: string;
  value: string;
  role?: string;
  /** Scope to the derived entity system (every role declaring this entity facet). */
  entity?: string;
  /**
   * Optional color resolver from the opener (the entity lens): maps an interval
   * to the EXACT color the timeline graphic uses for its category, so the list
   * and the band agree. Absent (standalone opens), the panel colors from its
   * own intervals — consistent, but not cross-component identical.
   */
  intervalColor?: (interval: TimelineInterval) => string | undefined;
}) {
  useEscalationAnalyticsEvents();
  const { closePanel } = useShellPanel();
  const scope: { query?: AnalyticsFilter } = entity
    ? { query: { entity } }
    : role
      ? { query: { roles: [role] } }
      : {};
  const { data, error, isLoading } = useTimelineByFacet({
    facet: { key: facetKey, value },
    ...scope,
    order: 'desc',
    limit: TIMELINE_PAGE_SIZE,
  });

  // Color resolution: the opener's resolver (the lens, period-matched to its
  // band) wins; otherwise derive the entity system's colors here so station
  // detail and cell popovers color by the same scheme. When a resolver is
  // supplied, the fallback does no fetching.
  const systemColor = useEntityStateColors({ entity, role }, { enabled: !intervalColor });
  const resolveColor = intervalColor ?? systemColor;

  // Head page, chronological. Older pages prepend before it.
  const headIntervals = [...(data?.intervals ?? [])].reverse();
  const [older, setOlder] = useState<TimelineInterval[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);

  // Reset accumulated pages when the newest interval set changes — a new facet
  // value, or a push-driven head refetch that shifted the recent end.
  const headSignature = data
    ? `${value}|${data.intervals.length}|${data.intervals[0]?.startedAt ?? ''}|${data.intervals[data.intervals.length - 1]?.startedAt ?? ''}`
    : null;
  const appliedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (headSignature === appliedSignature.current) return;
    appliedSignature.current = headSignature;
    setOlder([]);
    setHasEarlier(data?.overflow ?? false);
    setEarlierError(null);
  }, [headSignature, data]);

  const intervals = [...older, ...headIntervals];

  // Display order — the dashboard convention is most-recent first, so the
  // default is descending; the toggle is pure presentation over the loaded
  // window. Paging is unchanged either way: the head is the newest page and
  // the strict `before` cursor walks OLDER intervals — sound at thousands of
  // rows (a printer's lifetime runs to ~4500 intervals), no offsets to drift.
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const displayed = sortOrder === 'desc' ? [...intervals].reverse() : intervals;
  // The chronologically earlier/later pair for a rendered neighbor gap.
  const gapPair = (i: number): { prev: TimelineInterval; next: TimelineInterval } =>
    sortOrder === 'desc'
      ? { prev: displayed[i], next: displayed[i - 1] }
      : { prev: displayed[i - 1], next: displayed[i] };

  // Category colors — the same palette generator the timeline graphic uses,
  // keyed by each row's category and weighted by dwell so the dominant states
  // take the lead palette slots. The dot reads as "what this was," matching the
  // band segments on the left.
  const categoryColors = assignLabelColors(
    intervals.map((iv) => ({ label: categoryOf(iv), weight: iv.durationSeconds })),
  );

  const loadEarlier = async () => {
    const oldest = intervals[0]?.startedAt;
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierError(null);
    try {
      const page = await fetchTimelineByFacet({
        facet: { key: facetKey, value },
        ...scope,
        order: 'desc',
        before: oldest,
        limit: TIMELINE_PAGE_SIZE,
      });
      setOlder((prev) => [...[...page.intervals].reverse(), ...prev]);
      setHasEarlier(page.overflow);
    } catch (err) {
      setEarlierError((err as Error).message);
    } finally {
      setLoadingEarlier(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-surface-border/40">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Timeline · <span className="normal-case font-mono">{facetKey}</span>
          </p>
          <p className="text-sm font-mono text-text-primary truncate mt-0.5" title={value}>
            {value}
          </p>
          {intervals.length > 0 && (
            <p className="flex items-center gap-2 text-2xs text-text-quaternary mt-0.5">
              <span>{intervals.length} interval{intervals.length === 1 ? '' : 's'}</span>
              <span className="h-2.5 w-px bg-surface-border" />
              <button
                onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
                className="inline-flex items-center gap-0.5 icon-link"
                title={sortOrder === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
                data-testid="timeline-sort-toggle"
              >
                {sortOrder === 'desc'
                  ? <><ArrowDown className="w-2.5 h-2.5" /> newest first</>
                  : <><ArrowUp className="w-2.5 h-2.5" /> oldest first</>}
              </button>
            </p>
          )}
        </div>
        <span className="flex items-center gap-1 mt-0.5 shrink-0 ml-2">
          {entity && <CopyLinkButton entity={entity} value={value} />}
          {/* Search every queue for this facet value — the all-roles metadata search. */}
          <Link
            to={metadataFacetUrl(facetKey, value)}
            className="icon-link"
            title={`Search every queue for ${facetKey} ${value}`}
            data-testid="timeline-facet-search"
          >
            <Search className="w-3.5 h-3.5" />
          </Link>
          <button onClick={() => closePanel('entity-timeline')} className="icon-link">
            <X className="w-4 h-4" />
          </button>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <p className="text-2xs text-text-tertiary italic">Loading timeline…</p>
        ) : isForbidden(error) ? (
          <p className="text-2xs text-text-tertiary">
            Timeline requires full read access to this station's queue.
          </p>
        ) : error ? (
          <p className="text-2xs text-status-error">{(error as Error).message}</p>
        ) : intervals.length === 0 ? (
          <p className="text-2xs text-text-quaternary">
            No escalation has carried this value.
          </p>
        ) : (
          <div className="relative">
            {/* Older pages continue in the reading direction: at the TOP when
                oldest-first, at the BOTTOM when newest-first. */}
            {sortOrder === 'asc' && (
              <LoadOlderControl
                hasEarlier={hasEarlier}
                loading={loadingEarlier}
                error={earlierError}
                onLoad={loadEarlier}
                edge="top"
              />
            )}
            {/* Left rail behind the dots */}
            <div className="absolute left-[4px] top-2 bottom-2 w-px bg-surface-border" />
            <div className="space-y-0">
              {displayed.map((interval, i) => (
                <Fragment key={`${interval.startedAt}-${i}`}>
                  {i > 0 && <GapRow {...gapPair(i)} />}
                  <IntervalRow
                    interval={interval}
                    color={resolveColor(interval) ?? categoryColors.get(categoryOf(interval))}
                  />
                </Fragment>
              ))}
            </div>
            {sortOrder === 'desc' && (
              <LoadOlderControl
                hasEarlier={hasEarlier}
                loading={loadingEarlier}
                error={earlierError}
                onLoad={loadEarlier}
                edge="bottom"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The cursor pager — walks strictly-older intervals a page at a time. */
function LoadOlderControl({
  hasEarlier,
  loading,
  error,
  onLoad,
  edge,
}: {
  hasEarlier: boolean;
  loading: boolean;
  error: string | null;
  onLoad: () => void;
  edge: 'top' | 'bottom';
}) {
  if (!hasEarlier && !error) return null;
  return (
    <div className={`${edge === 'top' ? 'pb-2' : 'pt-2'} pl-5`}>
      {hasEarlier && (
        <button
          onClick={onLoad}
          disabled={loading}
          className="text-2xs text-text-tertiary hover:text-accent transition-colors disabled:opacity-40"
        >
          {loading ? 'Loading older…' : 'Load older'}
        </button>
      )}
      {error && <p className="text-2xs text-status-error mt-1">{error}</p>}
    </div>
  );
}

/** Copies the entity-lens deep link (?lens= + ?entity=) with a transient note. */
function CopyLinkButton({ entity, value }: { entity: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const url = `${window.location.origin}/operations?lens=${encodeURIComponent(entity)}&entity=${encodeURIComponent(value)}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="flex items-center gap-1">
      {copied && <span className="text-2xs text-text-quaternary">copied</span>}
      <button onClick={copy} className="icon-link" title="Copy link to this timeline">
        <LinkIcon className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

function IntervalRow({ interval, color }: { interval: TimelineInterval; color?: string }) {
  return (
    <div className="relative flex gap-3 py-2">
      {/* Filled dot in the row's CATEGORY color — matches the graphic's segments,
          so the list reads by state the same way the band does. */}
      <span
        className="w-[9px] h-[9px] rounded-full shrink-0 mt-1 relative z-10"
        style={{ backgroundColor: color ?? 'rgb(var(--lt-surface-border))' }}
        title={categoryOf(interval)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-mono text-text-primary truncate">
            {interval.role}
            {interval.subtype ? <span className="text-text-tertiary"> · {interval.subtype}</span> : null}
          </span>
          <span className="text-2xs font-mono tabular-nums text-text-secondary ml-auto shrink-0">
            {formatDurationCompact(interval.durationSeconds * 1000)}
          </span>
        </div>
        <p className="text-2xs font-mono text-text-tertiary mt-0.5">
          {formatDateTime(interval.startedAt)} → {interval.endedAt ? formatDateTime(interval.endedAt) : 'now'}
        </p>
      </div>
    </div>
  );
}

/** Untracked time between two intervals — the settle latency between queues, surfaced. */
function GapRow({ prev, next }: { prev: TimelineInterval; next: TimelineInterval }) {
  if (!prev.endedAt) return null;
  const gapMs = Date.parse(next.startedAt) - Date.parse(prev.endedAt);
  if (gapMs <= 1000) return null; // contiguous handoff
  return (
    <div className="relative flex items-center gap-3 py-1">
      <span className="w-[9px] shrink-0" />
      <div className="flex-1 border-t border-dashed border-surface-border/60" />
      <span className="text-2xs text-text-quaternary shrink-0">
        untracked · {formatDurationCompact(gapMs)}
      </span>
      <div className="flex-1 border-t border-dashed border-surface-border/60" />
    </div>
  );
}
