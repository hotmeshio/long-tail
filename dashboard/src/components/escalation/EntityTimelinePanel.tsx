import { Fragment } from 'react';
import { X } from 'lucide-react';
import {
  useTimelineByFacet,
  isForbidden,
  type TimelineInterval,
} from '../../api/escalation-analytics';
import { useEscalationAnalyticsEvents } from '../../hooks/useEventHooks';
import { useShellPanel } from '../../hooks/useShellPanel';
import { formatDateTime, formatDurationCompact } from '../../lib/format';

/**
 * One entity's escalation-interval timeline — every station the facet value
 * has moved through, as [started, ended) spans in created_at order. Gaps
 * between consecutive intervals are untracked time and render as explicit
 * separators: their size is the digital/physical settle latency, a health
 * signal, never hidden.
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
}: {
  facetKey: string;
  value: string;
  role?: string;
  /** Scope to the derived entity system (every role declaring this entity facet). */
  entity?: string;
}) {
  useEscalationAnalyticsEvents();
  const { closePanel } = useShellPanel();
  const { data, error, isLoading } = useTimelineByFacet({
    facet: { key: facetKey, value },
    ...(entity ? { query: { entity } } : role ? { query: { roles: [role] } } : {}),
  });

  const intervals = data?.intervals ?? [];

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
            <p className="text-2xs text-text-quaternary mt-0.5">
              {intervals.length} interval{intervals.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <button onClick={() => closePanel('entity-timeline')} className="icon-link mt-0.5 shrink-0 ml-2">
          <X className="w-4 h-4" />
        </button>
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
            {/* Left rail behind the dots */}
            <div className="absolute left-[4px] top-2 bottom-2 w-px bg-surface-border" />
            <div className="space-y-0">
              {intervals.map((interval, i) => (
                <Fragment key={`${interval.startedAt}-${i}`}>
                  {i > 0 && <GapRow prev={intervals[i - 1]} next={interval} />}
                  <IntervalRow interval={interval} />
                </Fragment>
              ))}
            </div>
            {data?.overflow && (
              <p className="text-2xs text-text-quaternary mt-3 pl-5">
                first {intervals.length} intervals shown
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function statusDotClass(interval: TimelineInterval): string {
  if (interval.endedAt === null) return 'bg-accent';
  if (interval.status === 'resolved') return 'bg-status-success-graphic';
  return 'bg-status-error';
}

function IntervalRow({ interval }: { interval: TimelineInterval }) {
  return (
    <div className="relative flex gap-3 py-2">
      <span
        className={`dot-ring w-[9px] h-[9px] rounded-full shrink-0 mt-1 relative z-10 ${statusDotClass(interval)}`}
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
