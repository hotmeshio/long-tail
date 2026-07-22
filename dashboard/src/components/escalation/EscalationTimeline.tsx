import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, ListFilter, ChevronDown, ChevronUp } from 'lucide-react';
import type { LTEscalationRecord } from '../../api/types';
import { metadataFacetUrl } from '../../lib/facet-url';
import { isEffectivelyClaimed } from '../../lib/escalation';

// Status hues resolve through the --lt-* theme tokens (space-separated RGB
// triplets) so registered themes restyle the timeline. STATUS_VAR keeps the
// bare variable name so the dot glow can derive translucent variants via the
// rgb(var(--x) / alpha) form.
const STATUS_VAR: Record<string, string> = {
  pending:   '--lt-status-queued-graphic',
  claimed:   '--lt-status-claimed-graphic',
  resolved:  '--lt-status-success-graphic',
  cancelled: '--lt-text-quaternary',
  expired:   '--lt-text-tertiary',
};

const FALLBACK_VAR = '--lt-text-quaternary';

function statusVar(status: string): string {
  return STATUS_VAR[status] ?? FALLBACK_VAR;
}

const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_VAR).map(([k, v]) => [k, `rgb(var(${v}))`]),
);

const CONNECTOR_W      = 40;
const TARGET_AVG_GAP_PX = 64;
const MIN_GAP_PX        = 24;
const DEFAULT_META_ROWS = 3;

function fmtMs(ms: number): string {
  if (ms < 60_000)      return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000)   return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000)  return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function fmtRelTime(ms: number): string {
  const ago = Date.now() - ms;
  if (ago < 60_000)      return 'just now';
  if (ago < 3_600_000)   return `${Math.round(ago / 60_000)}m ago`;
  if (ago < 86_400_000)  return `${Math.round(ago / 3_600_000)}h ago`;
  return `${Math.round(ago / 86_400_000)}d ago`;
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function allMetaEntries(
  metadata: Record<string, unknown> | null,
  highlightKeys: string[],
): [string, unknown][] {
  if (!metadata) return [];
  const keys = [
    ...highlightKeys.filter((k) => k in metadata),
    ...Object.keys(metadata).filter((k) => !highlightKeys.includes(k)),
  ];
  return keys.map((k) => [k, metadata[k]]);
}

interface Parsed extends LTEscalationRecord {
  startMs:       number;
  claimedMs:     number | null;
  endMs:         number;
  isOpen:        boolean;
  displayStatus: string;
}

// ------------------------------------------------------------------
// Lifecycle bar
// ------------------------------------------------------------------
function LifecycleBar({ e }: { e: Parsed }) {
  const totalMs = e.endMs - e.startMs;
  if (totalMs <= 0) return null;

  const pendingColor  = STATUS_COLOR.pending;
  const claimedColor  = STATUS_COLOR.claimed;
  const resolvedColor = e.status === 'cancelled' || e.status === 'expired'
    ? STATUS_COLOR.cancelled : STATUS_COLOR.resolved;

  let pendingPct  = 100;
  let claimedPct  = 0;
  let resolvedPct = 0;

  if (e.claimedMs !== null) {
    pendingPct = Math.max(0, Math.min(100, ((e.claimedMs - e.startMs) / totalMs) * 100));
    if (!e.isOpen) {
      claimedPct  = Math.max(0, Math.min(100 - pendingPct, ((e.endMs - e.claimedMs) / totalMs) * 100));
      resolvedPct = Math.max(0, 100 - pendingPct - claimedPct);
    } else {
      claimedPct = 100 - pendingPct;
    }
  } else if (!e.isOpen) {
    resolvedPct = 100; pendingPct = 0;
  }

  return (
    <div className="mt-2 h-0.5 rounded-full overflow-hidden flex bg-surface-sunken">
      {pendingPct  > 0 && <div style={{ width: `${pendingPct}%`,  backgroundColor: pendingColor,  opacity: 0.6 }} />}
      {claimedPct  > 0 && <div style={{ width: `${claimedPct}%`,  backgroundColor: claimedColor,  opacity: 0.6 }} />}
      {resolvedPct > 0 && <div style={{ width: `${resolvedPct}%`, backgroundColor: resolvedColor, opacity: 0.6 }} />}
    </div>
  );
}

// ------------------------------------------------------------------
// Gap zone
// ------------------------------------------------------------------
function GapZone({ gapMs, heightPx }: { gapMs: number; heightPx: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ height: heightPx }}>
      {gapMs >= 60_000 && (
        <span className="text-2xs text-text-quaternary font-mono bg-surface px-2 relative z-10">
          {fmtMs(gapMs)}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Card — compact, expand for extra meta rows
// ------------------------------------------------------------------
function TimelineCard({
  e,
  highlightKeys,
  onRowClick,
}: {
  e:             Parsed;
  highlightKeys: string[];
  onRowClick?:   (row: LTEscalationRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const color   = STATUS_COLOR[e.displayStatus] ?? `rgb(var(${FALLBACK_VAR}))`;
  const entries = allMetaEntries(e.metadata, highlightKeys);
  const shown   = expanded ? entries : entries.slice(0, DEFAULT_META_ROWS);
  const hiddenCount = entries.length - DEFAULT_META_ROWS;

  return (
    <div
      className="cursor-pointer max-w-[460px] min-w-[260px] w-full bg-surface-raised rounded-lg shadow-sm border border-surface-border/60 px-3.5 pt-2.5 pb-2 hover:shadow-md hover:border-surface-border transition-all duration-150"
      style={{ borderTopWidth: '3px', borderTopColor: color }}
      onClick={() => onRowClick?.(e)}
    >
      {/* Role eyebrow + type on same line */}
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-2xs font-bold uppercase tracking-widest text-text-quaternary shrink-0">
          {titleCase(e.role)}
        </span>
        <span className="text-xs font-semibold text-text-primary truncate" title={e.type}>
          {e.type}
          {e.subtype && e.subtype !== e.type && e.subtype !== '' && (
            <span className="font-normal text-text-tertiary"> · {e.subtype}</span>
          )}
        </span>
      </div>

      {/* Metadata rows — key (fixed) | value (flex) | icons (hover only) */}
      {shown.length > 0 && (
        <div className="border-t border-surface-border/40 pt-1 space-y-px">
          {shown.map(([k, v]) => {
            const sv          = String(v);
            const isHighlight = highlightKeys.includes(k);
            return (
              <div
                key={k}
                className="group/row flex items-center gap-1.5 -mx-1 px-1 py-[2px] rounded"
              >
                <span
                  className={`shrink-0 w-[60px] text-2xs font-mono uppercase tracking-wide truncate ${
                    isHighlight ? 'text-accent' : 'text-text-quaternary'
                  }`}
                  title={k}
                >
                  {k}
                </span>
                <span
                  className={`flex-1 min-w-0 text-2xs font-medium truncate ${
                    isHighlight ? 'text-text-primary' : 'text-text-tertiary'
                  }`}
                  title={sv}
                >
                  {sv}
                </span>
                {/* Filter icons — Links so native value type is preserved in the URL */}
                <span className="flex items-center gap-px shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
                  <Link
                    to={metadataFacetUrl(k, v, e.role)}
                    className="p-0.5 rounded text-text-quaternary hover:text-accent transition-colors"
                    title={`Filter ${titleCase(e.role)}: ${k} = ${sv}`}
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <ListFilter className="w-2.5 h-2.5" />
                  </Link>
                  <Link
                    to={metadataFacetUrl(k, v)}
                    className="p-0.5 rounded text-text-quaternary hover:text-accent transition-colors"
                    title={`Search all: ${k} = ${sv}`}
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <Search className="w-2.5 h-2.5" />
                  </Link>
                </span>
              </div>
            );
          })}

          {/* Expand / collapse */}
          {hiddenCount > 0 && (
            <button
              className="flex items-center gap-0.5 text-2xs text-text-quaternary hover:text-accent transition-colors mt-0.5 -mx-1 px-1 py-px"
              onClick={(ev) => { ev.stopPropagation(); setExpanded((v) => !v); }}
            >
              {expanded
                ? <><ChevronUp className="w-2.5 h-2.5" /> less</>
                : <><ChevronDown className="w-2.5 h-2.5" /> {hiddenCount} more</>}
            </button>
          )}
        </div>
      )}

      <LifecycleBar e={e} />
    </div>
  );
}

// ------------------------------------------------------------------
// Main export
// ------------------------------------------------------------------
export function EscalationTimeline({
  escalations,
  highlightKeys = [],
  onRowClick,
  total: _total,
  page,
  totalPages,
  onPageChange,
}: {
  escalations:    LTEscalationRecord[];
  highlightKeys?: string[];
  onRowClick?:    (row: LTEscalationRecord) => void;
  total:          number;
  page:           number;
  totalPages:     number;
  onPageChange:   (page: number) => void;
}) {
  const nowMs = Date.now();

  const parsed: Parsed[] = escalations.map((e) => {
    const startMs    = new Date(e.created_at).getTime();
    const resolvedMs = e.resolved_at ? new Date(e.resolved_at).getTime() : null;
    const claimedMs  = e.claimed_at  ? new Date(e.claimed_at).getTime()  : null;
    const isOpen     = !resolvedMs && e.status !== 'cancelled' && e.status !== 'expired';
    const endMs      = resolvedMs ?? (isOpen ? nowMs : startMs + 30_000);
    const displayStatus =
      e.status === 'pending' && isEffectivelyClaimed(e) ? 'claimed' : e.status;
    return { ...e, startMs, claimedMs, endMs, isOpen, displayStatus };
  });

  // The server's ORDER BY is authoritative for every view — render rows exactly
  // as given. (A client-side reverse here once assumed newest-first data and
  // silently cancelled ascending sorts.)
  const displayed = parsed;

  if (displayed.length === 0) {
    return <p className="mt-12 text-center text-sm text-text-tertiary">No escalations matched.</p>;
  }

  // Temporal scale
  const n         = displayed.length;
  const totalSpan = Math.max(
    Math.abs((displayed[n - 1]?.startMs ?? 0) - (displayed[0]?.startMs ?? 0)),
    1,
  );
  const avgGapMs = totalSpan / Math.max(n - 1, 1);
  const SCALE    = TARGET_AVG_GAP_PX / Math.max(avgGapMs, 1);

  // Absolute time format
  const dateSet  = new Set(displayed.map((e) => new Date(e.startMs).toDateString()));
  const multiDay = dateSet.size > 1;
  function fmtAbsTime(ms: number): string {
    const d    = new Date(ms);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!multiDay) return time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
  }

  return (
    <div className="mt-4 pb-24">

      {/* Spine */}
      <div className="relative">
        <div className="absolute left-1/2 -translate-x-px inset-y-0 w-px bg-surface-border/80" />

        {displayed.map((e, i) => {
          const prev   = displayed[i - 1];
          const gapMs  = prev ? Math.abs(e.startMs - prev.startMs) : null;
          const gapPx  = gapMs !== null ? Math.max(MIN_GAP_PX, Math.round(gapMs * SCALE)) : 0;
          const isLeft = i % 2 === 0;
          const dotVar = statusVar(e.displayStatus);
          const color  = `rgb(var(${dotVar}))`;

          const dur    = e.endMs - e.startMs;
          const timing = e.isOpen ? fmtRelTime(e.startMs) : `${fmtRelTime(e.startMs)} · ${fmtMs(dur)}`;

          return (
            <div key={e.id}>
              {i > 0 && <GapZone gapMs={gapMs!} heightPx={gapPx} />}

              <div className="flex items-center">
                {/* Left half: card or timing label */}
                <div className="flex-1 flex justify-end items-center">
                  {isLeft ? (
                    <div className="flex items-center">
                      <TimelineCard e={e} highlightKeys={highlightKeys} onRowClick={onRowClick} />
                      <div className="flex-shrink-0 h-px bg-surface-border/70" style={{ width: CONNECTOR_W }} />
                    </div>
                  ) : (
                    <span className="text-2xs text-text-quaternary font-mono tabular-nums pr-3">
                      {timing}
                    </span>
                  )}
                </div>

                {/* Dot */}
                <div
                  className="relative z-10 flex-shrink-0 w-3.5 h-3.5 rounded-full border-2 border-surface cursor-pointer transition-all duration-150 hover:scale-[1.5]"
                  style={{ backgroundColor: color, boxShadow: `0 0 0 3px rgb(var(${dotVar}) / 0.16), 0 1px 3px rgb(var(${dotVar}) / 0.19)` }}
                  onClick={() => onRowClick?.(e)}
                />

                {/* Right half: card or timing label */}
                <div className="flex-1 flex justify-start items-center">
                  {!isLeft ? (
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-px bg-surface-border/70" style={{ width: CONNECTOR_W }} />
                      <TimelineCard e={e} highlightKeys={highlightKeys} onRowClick={onRowClick} />
                    </div>
                  ) : (
                    <span className="text-2xs text-text-quaternary font-mono tabular-nums pl-3">
                      {timing}
                    </span>
                  )}
                </div>
              </div>

              {/* Absolute timestamp on spine */}
              <div className="flex justify-center relative z-10 mt-0.5">
                <span className="text-2xs text-text-quaternary font-mono tabular-nums bg-surface px-1.5">
                  {fmtAbsTime(e.startMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky pagination */}
      {totalPages > 1 && (
        <div className="sticky bottom-0 z-20 bg-surface/95 backdrop-blur-sm border-t border-surface-border -mx-page-x px-page-x pt-2 pb-4 flex items-center justify-between mt-10">
          <span className="text-2xs text-text-tertiary">
            Page <span className="font-medium text-text-secondary">{page}</span>
            {' '}of <span className="font-medium text-text-secondary">{totalPages}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded hover:bg-surface-hover disabled:opacity-30 text-text-tertiary hover:text-text-primary transition-colors disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded hover:bg-surface-hover disabled:opacity-30 text-text-tertiary hover:text-text-primary transition-colors disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
