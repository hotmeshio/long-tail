import type { AggregateRow } from '../../api/escalation-analytics';
import { totalDwell } from './entity-pivot';

// The legend box is bounded — never a scrolling list. Beyond this the tail
// folds into a single "+N more" line so the header can't grow the view.
const MAX_ROWS = 10;

function durationLabel(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours <= 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The state-mix rollup as an infographic: a sorted ranked-bar legend (Region A)
 * beside a headline insight (Region B). Bars are scaled to the leader so the
 * ranking reads by length; the label sits right-aligned inside each bar in
 * inverse ink, the exact share trailing it.
 */
export function MixSummary({
  groups,
  colors,
  stateLabel,
  nowByState,
  periodHours,
  tracked,
  entityKey,
}: {
  groups: AggregateRow[];
  colors: Map<string, string>;
  stateLabel: (state: string | undefined) => string;
  nowByState: Map<string, number>;
  periodHours: number;
  tracked: number | null;
  entityKey: string;
}) {
  const total = totalDwell(groups);
  const ranked = [...groups]
    .filter((g) => (g.dwellSeconds ?? 0) > 0)
    .sort((a, b) => (b.dwellSeconds ?? 0) - (a.dwellSeconds ?? 0))
    .map((g) => ({
      state: g.state ?? '—',
      label: stateLabel(g.state),
      pct: total > 0 ? Math.round(((g.dwellSeconds ?? 0) / total) * 100) : 0,
      color: colors.get(g.state ?? '—'),
      now: nowByState.get(g.state ?? '—') ?? 0,
    }));

  const leadPct = ranked[0]?.pct || 1;
  const visible = ranked.slice(0, MAX_ROWS);
  const hidden = ranked.length - visible.length;
  const top = ranked[0];

  return (
    <>
      {/* Region A — the sorted ranked-bar legend */}
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
          Where the time went · <span className="normal-case font-mono">{entityKey}</span> system
        </p>
        <div className="space-y-px max-h-40 overflow-hidden">
          {visible.map((s) => (
            <div
              key={s.state}
              className="relative h-3 rounded-sm bg-surface-sunken overflow-hidden"
              title={`${s.label} · ${s.pct}%${s.now > 0 ? ` · ${s.now} now` : ''}`}
            >
              <div
                className="absolute inset-y-0 left-0 flex items-center justify-end gap-1 pr-1.5 rounded-sm"
                style={{ width: `${Math.max((s.pct / leadPct) * 100, 0)}%`, minWidth: '4.25rem', backgroundColor: s.color }}
              >
                <span className="text-[10px] leading-none font-mono font-medium text-white/95 truncate">{s.label}</span>
                <span className="text-[10px] leading-none font-mono tabular-nums text-white/75 shrink-0">{s.pct}%</span>
              </div>
            </div>
          ))}
          {hidden > 0 && (
            <p className="text-[10px] text-text-quaternary pl-1 pt-0.5">+{hidden} more stages</p>
          )}
        </div>
      </div>

      {/* Region B — the headline insight */}
      <div className="shrink-0 w-52 pl-6 border-l border-surface-border/40 flex flex-col justify-center">
        <p className="text-2xs uppercase tracking-widest text-text-tertiary">Last {durationLabel(periodHours)}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-light text-text-primary tabular-nums leading-none">{top?.pct ?? 0}%</span>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: top?.color }} />
        </p>
        <p className="text-xs text-text-secondary mt-1">
          <span className="font-mono font-medium text-text-primary">{top?.label}</span> is the biggest time sink
        </p>
        <p className="text-2xs text-text-tertiary mt-1">
          across {ranked.length} stages
          {tracked != null && (
            <> · <span className="font-mono font-semibold text-text-primary tabular-nums">{tracked}</span> <span className="font-mono">{entityKey}</span> in queue now</>
          )}
        </p>
      </div>
    </>
  );
}
