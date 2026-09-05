import type { AggregateRow } from '../../api/escalation-analytics';
import { totalDwell } from './entity-pivot';

/** One stacked band of state dwell. */
export function StateBand({
  groups,
  colors,
  height,
  rounded = 'rounded-sm',
  className = '',
}: {
  groups: AggregateRow[];
  colors: Map<string, string>;
  height: string;
  rounded?: string;
  className?: string;
}) {
  const total = totalDwell(groups);
  // Segments render in the GLOBAL color order (the colors map is built in
  // dwell-rank order — blue → orange → green → …), not each band's own
  // dominant-first order. A fixed sequence makes ratios comparable at a glance
  // across the system band, slice headers, and every per-entity row.
  const rank = new Map([...colors.keys()].map((k, i) => [k, i]));
  const ordered = [...groups].sort(
    (a, b) => (rank.get(a.state ?? '—') ?? Infinity) - (rank.get(b.state ?? '—') ?? Infinity),
  );
  return (
    <div className={`${height} flex ${rounded} overflow-hidden bg-surface-sunken ${className}`}>
      {ordered.map((g) => {
        const pct = total > 0 ? Math.round(((g.dwellSeconds ?? 0) / total) * 100) : 0;
        return (
          <div
            key={g.state ?? '—'}
            title={`${g.state ?? '—'} · ${pct}%`}
            style={{ width: `${((g.dwellSeconds ?? 0) / total) * 100}%`, backgroundColor: colors.get(g.state ?? '—') }}
          />
        );
      })}
    </div>
  );
}
